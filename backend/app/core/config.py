from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import List

class Settings(BaseSettings):
    # API & Security
    environment: str = Field(default="production")
    admin_token: str = Field(...)
    access_code: str = Field(default="")
    allowed_origins: List[str] = Field(default=["*"])
    
    # Rate Limiting & Jobs
    rate_per_hour: int = Field(default=30)
    max_concurrent_jobs: int = Field(default=2)
    job_ttl_hours: float = Field(default=24.0)
    
    # Supabase (Database)
    supabase_url: str = Field(...)
    supabase_key: str = Field(...)
    
    # LLM Configuration
    llm_base_url: str = Field(default="https://api.openai.com/v1")
    llm_api_key: str = Field(...)
    llm_model: str = Field(default="gpt-4o")
    llm_mode: str = Field(default="chat", pattern="^(chat|lmm)$")
    
    # CAD Execution
    out_dir: str = Field(default="/tmp/cad_out")
    cad_workers: int = Field(default=2)
    cad_timeout_seconds: int = Field(default=90)
    cad_mem_limit_mb: int = Field(default=4096)
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()