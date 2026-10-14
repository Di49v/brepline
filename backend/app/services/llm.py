import re
import json
import logging
import asyncio
from typing import List, Dict, Any, Literal
from openai import AsyncOpenAI
from langsmith.wrappers import wrap_openai
from app.core.config import settings

logger = logging.getLogger(__name__)

AgentRole = Literal["intent", "planner", "modifier", "coder"]

class LLMService:
    def __init__(self):
        # 1. Local/Default Fallback Client
        self.local_client = wrap_openai(AsyncOpenAI(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            timeout=90.0
        ))

        # 2. Google Gemini Client (High-Quota Free Tier: 3.5-flash-lite, gemma-4-31b-it, 3.8-flash, embedding-2)
        self.gemini_client = wrap_openai(AsyncOpenAI(
            base_url=settings.gemini_base_url,
            api_key=settings.gemini_api_key,
            timeout=60.0
        )) if settings.gemini_api_key else None

        # 3. Groq Cloud Client (Ultra-fast Planner: openai/gpt-oss-120b)
        self.planner_client = wrap_openai(AsyncOpenAI(
            base_url=settings.plan_base_url,
            api_key=settings.plan_api_key,
            timeout=45.0
        )) if settings.plan_api_key else None

        # 4. Teammate's Fine-Tuned Cluster Client (Agent 2B Primary Coder)
        self.coder_client = wrap_openai(AsyncOpenAI(
            base_url=settings.coder_base_url,
            api_key=settings.coder_api_key,
            timeout=120.0
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
        """Executes an async chat completion with automatic multi-provider failover."""
        candidates = self._get_candidate_chain(role)
        last_err = None

        for client, model in candidates:
            for attempt in range(2):
                try:
                    r = await client.chat.completions.create(
                        model=model,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens
                    )
                    content = r.choices[0].message.content or ""
                    if content.strip():
                        return content
                except Exception as e:
                    last_err = e
                    logger.warning(f"[{role.upper()}] {model} (attempt {attempt+1}) failed: {e}")
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
        """Extracts python code blocks safely from LLM text outputs."""
        m = re.search(r"```(?:python|py)?\s*\n(.*?)(?:```|$)", text, re.S)
        if m:
            return m.group(1).strip() + "\n"
        if "import cadquery" in text or "result" in text:
            return text.strip() + "\n"
        return ""

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