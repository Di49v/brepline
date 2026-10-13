import os
import re
import json
import logging
import asyncio
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from app.core.config import settings

logger = logging.getLogger(__name__)

class LLMService:
    def __init__(self):
        self.client = AsyncOpenAI(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            timeout=120.0
        )
        # Use a distinct planner URL/model if configured
        self.planner_client = None
        if os.getenv("PLAN_BASE_URL"):
            self.planner_client = AsyncOpenAI(
                base_url=os.getenv("PLAN_BASE_URL"),
                api_key=os.getenv("PLAN_API_KEY", settings.llm_api_key),
                timeout=60.0
            )

    async def generate(self, messages: List[Dict[str, str]], temperature: float = 0.2, max_tokens: int = 2500, planner: bool = False, extra_body: dict = None) -> str:
        """Executes an async chat completion."""
        client = self.planner_client if (planner and self.planner_client) else self.client
        model = os.getenv("PLAN_MODEL") if (planner and self.planner_client) else settings.llm_model
        
        eb = dict(extra_body or {})
        if settings.llm_mode == "lmm" and not planner:
            pass # adapter handles logic
        else:
            max_tokens = max(max_tokens, 4000)
            
        kwargs = {"extra_body": eb} if eb else {}
        
        last_err = None
        for i in range(3):
            try:
                r = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs
                )
                return r.choices[0].message.content or ""
            except Exception as e:
                last_err = e
                if i < 2:
                    await asyncio.sleep(2 ** i)
        
        raise RuntimeError(f"LLM call failed after 3 retries: {last_err}")

    @staticmethod
    def extract_code(text: str) -> str:
        """Extracts python code blocks safely."""
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