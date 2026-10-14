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

        # 2. Google Gemini Client (Increased timeout to 180s for heavy code gen)
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
        max_tokens: int = 2500,
        role: AgentRole = "planner"
    ) -> str:
        """Executes chat completion with automatic failover and robust timeout catching."""
        candidates = self._get_candidate_chain(role)
        last_err = None

        for client, model in candidates:
            for attempt in range(2):
                try:
                    r = await client.completions.create if False else await client.chat.completions.create(
                        model=model,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens
                    )
                    content = r.choices[0].message.content or ""
                    if content.strip():
                        return content
                except (APITimeoutError, asyncio.TimeoutError, Exception) as e:
                    last_err = e
                    logger.warning(f"[{role.upper()}] {model} (attempt {attempt+1}) failed/timed out: {e}")
                    if attempt == 0:
                        await asyncio.sleep(1)

        raise RuntimeError(f"All LLM providers failed for role={role}. Last error: {last_err}")

    async def get_embedding(self, text: str) -> list[float]:
        """Generates a 768-dim vector via Gemini Embedding 2 (or local nomic-embed-text fallback)."""
        if self.gemini_client:
            try:
                response = await self.gemini_client.embeddings.create(
                    model=settings.embedding_model,
                    input=text,
                    dimensions=768  # MRL truncation to match Supabase vector(768)
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
        """Extracts python code blocks safely, filtering out stray markdown text or bullet points."""
        m = re.search(r"```(?:python|py)?\s*\n(.*?)(?:```|$)", text, re.S)
        raw_code = m.group(1).strip() if m else text.strip()
        
        if not raw_code and ("import cadquery" in text or "result" in text):
            raw_code = text.strip()

        # Clean up lines inside the code block that are accidental markdown/bullet points
        cleaned_lines = []
        for line in raw_code.splitlines():
            stripped = line.strip()
            # Skip stray bullet points, markdown headers, or LaTeX math lines that aren't valid Python comments
            if stripped.startswith(('* ', '- ')) and not stripped.startswith('#'):
                # Convert bullet to a Python comment if it looks like a note
                cleaned_lines.append(f"# {stripped[2:]}")
                continue
            if stripped.startswith('$') or ('$' in stripped and '=' in stripped and not any(op in stripped for op in ['+', '-', '*', '/', '=', '=='])):
                cleaned_lines.append(f"# {stripped}")
                continue
            cleaned_lines.append(line)

        raw_code = "\n".join(cleaned_lines)

        # Handle top-level indentation anomalies
        lines = raw_code.splitlines()
        non_empty_lines = [l for l in lines if l.strip()]
        if non_empty_lines:
            leading_spaces = [len(l) - len(l.lstrip(' ')) for l in non_empty_lines if not l.strip().startswith('#')]
            if leading_spaces and min(leading_spaces) > 0:
                min_indent = min(leading_spaces)
                dedented_lines = [
                    line[min_indent:] if line.strip() and len(line) >= min_indent and line[:min_indent].isspace() else line
                    for line in lines
                ]
                raw_code = "\n".join(dedented_lines)

        return raw_code + "\n"

    @staticmethod
    def extract_json(text: str) -> Dict[str, Any]:
        """Safely extracts JSON objects from LLM outputs."""
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            return {}
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}