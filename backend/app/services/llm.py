import re
import json
import logging
import asyncio
from typing import List, Dict, Any, Literal
from openai import AsyncOpenAI, APITimeoutError
from langsmith.wrappers import wrap_openai
from app.core.config import settings

logger = logging.getLogger(__name__)

AgentRole = Literal["intent", "planner", "modifier", "coder"]

class LLMService:
    def __init__(self):
        # 1. Local/Default Fallback Client (120s timeout)
        self.local_client = wrap_openai(AsyncOpenAI(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            timeout=120.0
        ))

        # 2. Google Gemini Client (180s timeout for deep spatial reasoning + code gen)
        self.gemini_client = wrap_openai(AsyncOpenAI(
            base_url=settings.gemini_base_url,
            api_key=settings.gemini_api_key,
            timeout=180.0
        )) if settings.gemini_api_key else None

        # 3. Groq Cloud Client (120s timeout)
        self.planner_client = wrap_openai(AsyncOpenAI(
            base_url=settings.plan_base_url,
            api_key=settings.plan_api_key,
            timeout=120.0
        )) if settings.plan_api_key else None

        # 4. Teammate's Fine-Tuned Cluster Client (180s timeout)
        self.coder_client = wrap_openai(AsyncOpenAI(
            base_url=settings.coder_base_url,
            api_key=settings.coder_api_key,
            timeout=180.0
        ))

    def _get_candidate_chain(self, role: AgentRole):
        """Returns an ordered list of (client, model_name) tuples for automatic failover."""
        chain = []
        if role == "intent":
            if self.gemini_client:
                chain.append((self.gemini_client, settings.intent_model))
            if self.planner_client:
                chain.append((self.planner_client, settings.plan_model))
        elif role == "planner":
            if self.planner_client:
                chain.append((self.planner_client, settings.plan_model))
            if self.gemini_client:
                chain.append((self.gemini_client, settings.modifier_model))
        elif role == "modifier":
            if self.gemini_client:
                chain.append((self.gemini_client, settings.modifier_model))
            if self.planner_client:
                chain.append((self.planner_client, settings.plan_model))
        elif role == "coder":
            chain.append((self.coder_client, settings.coder_model))
            if self.gemini_client:
                chain.append((self.gemini_client, settings.coder_fallback_model))
                chain.append((self.gemini_client, settings.modifier_model))
            if self.planner_client:
                chain.append((self.planner_client, settings.plan_model))

        chain.append((self.local_client, settings.llm_model))
        return chain

    async def generate(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 4096,
        role: AgentRole = "planner"
    ) -> str:
        """Executes chat completion with full 16K reasoning headroom and instant provider failover."""
        candidates = self._get_candidate_chain(role)
        last_err = None

        # Full 16K headroom so gemma-4-31b-it / gemini-3.8-flash never truncate 9K-12K first-pass builds
        role_min_tokens = 16384 if role == "coder" else (8192 if role == "planner" else 4096)
        effective_max_tokens = max(max_tokens, role_min_tokens)

        for client, model in candidates:
            try:
                kwargs: Dict[str, Any] = {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": effective_max_tokens,
                }
                if "gpt-oss" in model:
                    kwargs["reasoning_effort"] = "medium"

                r = await client.chat.completions.create(**kwargs)
                choice = r.choices[0]
                raw_content = choice.message.content or ""

                clean_content = self.strip_thoughts(raw_content)

                if choice.finish_reason == "length":
                    if role in ("coder", "modifier") and "```" not in clean_content[clean_content.find("```")+3:]:
                        logger.warning(f"[{role.upper()}] {model} hit token limit mid-code; rotating to next model.")
                        continue
                    if role == "planner" and not clean_content.rstrip().endswith("}"):
                        logger.warning(f"[{role.upper()}] {model} hit token limit mid-JSON; rotating to next model.")
                        continue

                if clean_content.strip():
                    return clean_content

            except (APITimeoutError, asyncio.TimeoutError, Exception) as e:
                last_err = e
                # Immediately rotate to the next healthy model in the chain instead of waiting on a congested one
                logger.warning(f"[{role.upper()}] {model} failed/rate-limited ({e}); failing over to next model.")
                continue

        raise RuntimeError(f"All LLM providers failed for role={role}. Last error: {last_err}")

    @staticmethod
    def strip_thoughts(text: str) -> str:
        """Removes <thought>...</thought> or <think>...</think> blocks emitted by reasoning models."""
        if not text:
            return ""
        # Remove closed <thought>...</thought> and <think>...</think> blocks
        text = re.sub(r"<(?:thought|think)>.*?</(?:thought|think)>", "", text, flags=re.S | re.I)
        # If the model got truncated inside an unclosed <thought> tag, strip from <thought> to end
        text = re.sub(r"<(?:thought|think)>.*\$", "", text, flags=re.S | re.I)
        return text.strip()

    async def get_embedding(self, text: str) -> list[float]:
        """Generates a 768-dim vector via Gemini Embedding 2 (or local nomic-embed-text fallback)."""
        if self.gemini_client:
            try:
                response = await self.gemini_client.embeddings.create(
                    model=settings.embedding_model,
                    input=text,
                    dimensions=768
                )
                return response.data[0].embedding
            except Exception as e:
                logger.warning(f"Gemini embedding failed, falling back to local Ollama: {e}")

        response = await self.local_client.embeddings.create(
            model="nomic-embed-text",
            input=text
        )
        return response.data[0].embedding

    

    @staticmethod
    def extract_code(text: str) -> str:
        """Extracts Python code safely after stripping reasoning tags and markdown noise."""
        cleaned = LLMService.strip_thoughts(text)
        if not cleaned:
            return ""

        m = re.search(r"```(?:python|py)?\s*\n(.*?)(?:```|\$)", cleaned, re.S)
        if m:
            raw_code = m.group(1).strip()
        elif "import cadquery" in cleaned or "result" in cleaned or "parts" in cleaned:
            raw_code = cleaned.strip()
        else:
            return ""

        # Filter out stray markdown lines if any slipped inside the fence
        valid_lines = []
        for line in raw_code.splitlines():
            s = line.strip()
            # 1. Skip stray tags or markdown fences
            if s.startswith(("<thought>", "</thought>", "<think>", "</think>", "```")):
                continue
            # 2. Convert stray markdown bullets or numbered lists into safe Python comments
            if (s.startswith(("* ", "- ")) or re.match(r"^\d+\.\s", s)) and not s.startswith("#"):
                valid_lines.append(f"# {s}")
                continue
            # 3. Convert any line containing LaTeX math ($) into a safe Python comment
            if "$" in s and not s.startswith("#"):
                valid_lines.append(f"# {s}")
                continue
            valid_lines.append(line)

        raw_code = "\n".join(valid_lines)

        # Normalize top-level indentation if the entire block was indented
        lines = raw_code.splitlines()
        non_empty = [l for l in lines if l.strip() and not l.strip().startswith("#")]
        if non_empty:
            min_indent = min(len(l) - len(l.lstrip(" ")) for l in non_empty)
            if min_indent > 0:
                lines = [l[min_indent:] if len(l) >= min_indent and l[:min_indent].isspace() else l for l in lines]
                raw_code = "\n".join(lines)

        return (raw_code.strip() + "\n") if raw_code.strip() else ""

    @staticmethod
    def extract_json(text: str) -> Dict[str, Any]:
        """Extracts JSON object safely after stripping <thought> blocks."""
        cleaned = LLMService.strip_thoughts(text)
        m = re.search(r"\{.*\}", cleaned, re.S)
        if not m:
            return {}
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}