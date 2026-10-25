from pathlib import Path
from typing import List
from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = BACKEND_DIR / ".env"


def _parse_key_list(primary: str, multi: str) -> List[str]:
    """Combines single key and comma-separated key pools into a deduplicated list."""
    raw = f"{multi},{primary}" if multi else primary
    seen = set()
    keys: List[str] = []
    for k in ( raw or "" ).split(","):
        clean = k.strip().strip('"').strip("'")
        if clean and clean not in seen:
            seen.add(clean)
            keys.append(clean)
    return keys


class Settings(BaseSettings):
    # API & Security
    environment: str = Field(default="development")
    admin_token: str = Field(default="test_admin_token")
    access_code: str = Field(default="")
    allowed_origins: str = Field(default="*")

    # Rate Limiting & Jobs
    rate_per_hour: int = Field(default=30)
    max_concurrent_jobs: int = Field(default=2)
    job_ttl_hours: float = Field(default=24.0)

    # Supabase (Database)
    supabase_url: str = Field(
        default="https://test.supabase.co",
        validation_alias=AliasChoices("SUPABASE_URL", "supabase_url")
    )
    supabase_key: str = Field(
        default="test_key",
        validation_alias=AliasChoices("SUPABASE_KEY", "SUPABASE_SERVICE_KEY", "supabase_key", "supabase_service_key")
    )

    # Google Gemini Cloud (Supports single GEMINI_API_KEY or comma-separated GEMINI_API_KEYS)
    gemini_base_url: str = Field(default="https://generativelanguage.googleapis.com/v1beta/openai/")
    gemini_api_key: str = Field(default="")
    gemini_api_keys: str = Field(
        default="",
        validation_alias=AliasChoices("GEMINI_API_KEYS", "gemini_api_keys")
    )
    intent_model: str = Field(default="gemini-3.5-flash-lite")
    modifier_model: str = Field(default="gemma-4-31b-it")
    coder_fallback_model: str = Field(default="gemini-3.8-flash")
    embedding_model: str = Field(default="gemini-embedding-2")

    # Groq Cloud Planner (Supports single PLAN_API_KEY or comma-separated PLAN_API_KEYS)
    plan_base_url: str = Field(default="https://api.groq.com/openai/v1")
    plan_api_key: str = Field(default="")
    plan_api_keys: str = Field(
        default="",
        validation_alias=AliasChoices("PLAN_API_KEYS", "GROQ_API_KEYS", "plan_api_keys")
    )
    plan_model: str = Field(default="openai/gpt-oss-120b")

    # Teammate's Cluster Coder (Agent 2B)
    coder_base_url: str = Field(default="http://localhost:11434/v1")
    coder_api_key: str = Field(default="ollama")
    coder_model: str = Field(default="brepline")

    # Local Fallback LLM Configuration
    llm_base_url: str = Field(default="http://localhost:11434/v1")
    llm_api_key: str = Field(default="ollama")
    llm_model: str = Field(default="qwen2.5-coder:7b")
    llm_mode: str = Field(default="chat")

    # CAD Execution
    out_dir: str = Field(default="/tmp/cad_out")
    cad_workers: int = Field(default=2)
    cad_timeout_seconds: int = Field(default=90, validation_alias=AliasChoices("CAD_TIMEOUT", "cad_timeout_seconds"))
    cad_mem_limit_mb: int = Field(default=4096, validation_alias=AliasChoices("CAD_MEM_MB", "cad_mem_limit_mb"))

    @property
    def gemini_key_pool(self) -> List[str]:
        """Returns all configured Gemini API keys for per-model sharding."""
        return _parse_key_list(self.gemini_api_key, self.gemini_api_keys)

    @property
    def plan_key_pool(self) -> List[str]:
        """Returns all configured Groq API keys for per-model sharding."""
        return _parse_key_list(self.plan_api_key, self.plan_api_keys)

    @property
    def cors_origins(self) -> List[str]:
        """Safely parses comma-separated, JSON, or wildcard origins."""
        val = (self.allowed_origins or "").strip()
        if not val or val == "*":
            return ["*"]
        if val.startswith("[") and val.endswith("]"):
            import json
            try:
                parsed = json.loads(val)
                if isinstance(parsed, list):
                    return [str(x).strip() for x in parsed if str(x).strip()]
            except Exception:
                pass
        return [o.strip() for o in val.split(",") if o.strip()]

    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH) if ENV_PATH.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()