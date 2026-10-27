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
    """
    Multi-Provider, Per-Model Key-Sharded LLM Orchestration Service.
    
    Enforces `max_retries=0` at the HTTP client level so rate-limited or congested
    API keys rotate immediately to the next key shard or model without hidden
    exponential backoff delays.
    """

    def __init__(self):
        # 1. Local/Default Fallback Client
        self.local_client = wrap_openai(AsyncOpenAI(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            timeout=120.0,
            max_retries=0
        ))

        # 2. Google Gemini Client Pool (Sharded across all keys in GEMINI_API_KEYS / GEMINI_API_KEY)
        self.gemini_clients: List[Any] = [
            wrap_openai(AsyncOpenAI(
                base_url=settings.gemini_base_url,
                api_key=key,
                timeout=300.0,
                max_retries=0
            ))
            for key in settings.gemini_key_pool
        ]

        # 3. Groq Cloud Client Pool (Sharded across all keys in PLAN_API_KEYS / PLAN_API_KEY)
        self.planner_clients: List[Any] = [
            wrap_openai(AsyncOpenAI(
                base_url=settings.plan_base_url,
                api_key=key,
                timeout=120.0,
                max_retries=0
            ))
            for key in settings.plan_key_pool
        ]

        # 4. Teammate's Fine-Tuned Cluster Client
        self.coder_client = wrap_openai(AsyncOpenAI(
            base_url=settings.coder_base_url,
            api_key=settings.coder_api_key,
            timeout=180.0,
            max_retries=0
        ))

        # Per-model round-robin cursor: maps model_name -> next key index
        self._model_cursors: Dict[str, int] = {}

    def _sharded_clients_for_model(self, pool: List[Any], model: str) -> List[Any]:
        """
        Returns the client pool ordered starting from this model's current round-robin cursor,
        and advances the cursor so the next call to the SAME model uses the next API key.
        """
        if not pool:
            return []
        n = len(pool)
        idx = self._model_cursors.get(model, 0) % n
        self._model_cursors[model] = (idx + 1) % n
        return pool[idx:] + pool[:idx]

    def _get_candidate_chain(self, role: AgentRole) -> List[tuple[Any, str]]:
        """
        Builds an ordered list of (client, model_name) pairs.
        Prioritizes Gemini 3.8 Flash for CAD coding quality, rotating across all
        configured Gemini keys before falling back to Gemma 4 and Groq.
        """
        chain: List[tuple[Any, str]] = []

        def add_pool(pool: List[Any], model: str):
            for c in self._sharded_clients_for_model(pool, model):
                chain.append((c, model))

        if role == "intent":
            add_pool(self.gemini_clients, settings.intent_model)
            add_pool(self.planner_clients, settings.plan_model)
            add_pool(self.gemini_clients, settings.modifier_model)

        elif role == "planner":
            add_pool(self.planner_clients, settings.plan_model)
            add_pool(self.gemini_clients, settings.modifier_model)
            add_pool(self.gemini_clients, settings.intent_model)

        elif role == "modifier":
            # 1. Gemini 3.8 Flash & Gemma 4 31B for accurate parametric code edits
            add_pool(self.gemini_clients, settings.coder_fallback_model)
            add_pool(self.gemini_clients, settings.modifier_model)
            # 2. Groq gpt-oss-120b fallback
            add_pool(self.planner_clients, settings.plan_model)

        elif role == "coder":
            # 1. Teammate's fine-tuned cluster (skip if pointing to unstarted localhost)
            if "localhost" not in settings.coder_base_url:
                chain.append((self.coder_client, settings.coder_model))
            # 2. Primary Cloud Coder: Gemini 3.8 Flash (all sharded keys)
            add_pool(self.gemini_clients, settings.coder_fallback_model)
            # 3. Secondary Gemini Coder: Gemma 4 31B IT (all sharded keys)
            add_pool(self.gemini_clients, settings.modifier_model)
            # 4. Fast LPU Failover: Groq gpt-oss-120b (all sharded keys)
            add_pool(self.planner_clients, settings.plan_model)

        chain.append((self.local_client, settings.llm_model))
        return chain

    async def generate(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 4096,
        role: AgentRole = "planner"
    ) -> str:
        """Executes chat completion with per-model key rotation and truncation protection."""
        candidates = self._get_candidate_chain(role)
        last_err = None

        role_min_tokens = 16384 if role == "coder" else (8192 if role in ("planner", "modifier") else 4096)
        effective_max_tokens = max(max_tokens, role_min_tokens)

        for idx, (client, model) in enumerate(candidates):
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
                    if role in ("coder", "modifier") and "```" not in clean_content[clean_content.find("```") + 3:]:
                        logger.warning(f"[{role.upper()}] {model} (candidate #{idx+1}) hit token limit mid-code; rotating.")
                        continue
                    if role == "planner" and not clean_content.rstrip().endswith("}"):
                        logger.warning(f"[{role.upper()}] {model} (candidate #{idx+1}) hit token limit mid-JSON; rotating.")
                        continue

                if clean_content.strip():
                    return clean_content

            except (APITimeoutError, asyncio.TimeoutError, Exception) as e:
                last_err = e
                # Immediately rotate to the next healthy model in the chain instead of waiting on a congested one
                logger.warning(f"[{role.upper()}] {model} (candidate #{idx+1}) failed ({e}); rotating immediately.")
                continue

        raise RuntimeError(f"All LLM providers and key shards failed for role={role}. Last error: {last_err}")

    @staticmethod
    def strip_thoughts(text: str) -> str:
        """Removes <thought>...</thought> or <think>...</think> blocks emitted by reasoning models."""
        if not text:
            return ""
        # Remove closed <thought>...</thought> and <think>...</think> blocks
        text = re.sub(r"<(?:thought|think)>.*?</(?:thought|think)>", "", text, flags=re.S | re.I)
        # If the model got truncated inside an unclosed <thought> tag, strip from <thought> to end
        text = re.sub(r"<(?:thought|think)>.*$", "", text, flags=re.S | re.I)
        return text.strip()

    async def get_embedding(self, text: str) -> list[float]:
        """Generates a 768-dim vector via sharded Gemini Embedding 2 keys (or local fallback)."""
        for client in self._sharded_clients_for_model(self.gemini_clients, settings.embedding_model):
            try:
                response = await client.embeddings.create(
                    model=settings.embedding_model,
                    input=text,
                    dimensions=768
                )
                return response.data[0].embedding
            except Exception as e:
                logger.warning(f"Gemini embedding shard failed, trying next key/fallback: {e}")

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

        m = re.search(r"```(?:python|py)?\s*\n(.*?)(?:```|$)", cleaned, re.S)
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
            if "\$" in s and not s.startswith("#"):
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