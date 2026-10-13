import os
from pathlib import Path
from typing import List
from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = BACKEND_DIR / ".env"

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
    
    # LLM Configuration (Reasoning / Agents 0 & 1)
    llm_base_url: str = Field(default="http://localhost:11434/v1")
    llm_api_key: str = Field(default="ollama")
    llm_model: str = Field(default="qwen2.5-coder")
    llm_mode: str = Field(default="chat")
    
    # Coder Configuration (Agent 2)
    coder_base_url: str = Field(default="http://localhost:11434/v1")
    coder_api_key: str = Field(default="ollama")
    coder_model: str = Field(default="qwen2.5-coder:7b")

    # CAD Execution
    out_dir: str = Field(default="/tmp/cad_out")
    cad_workers: int = Field(default=2)
    cad_timeout_seconds: int = Field(default=90)
    cad_mem_limit_mb: int = Field(default=4096)

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