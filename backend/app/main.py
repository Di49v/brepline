from dotenv import load_dotenv
load_dotenv()  # Injects .env into os.environ for LangSmith

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.routes import router

app = FastAPI(title="Brepline API", version="2.0.0")

# Dynamic CORS Strategy
if settings.environment == "development":
    # Open local development ports
    origins = list(set([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        *settings.cors_origins
    ]))
else:
    # Strict production origins parsing
    origins = settings.cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

@app.get("/api/health")
async def health_check():
    """Validates runtime dependencies without loading the 400MB OpenCascade binary into the web process."""
    import importlib.util
    cq_ok = importlib.util.find_spec("cadquery") is not None
    return {
        "ok": True,
        "cadquery_installed": cq_ok,
        "llm_configured": bool(settings.llm_base_url and settings.llm_api_key),
        "llm_model": settings.llm_model,
        "database": "supabase",
        "environment": settings.environment
    }