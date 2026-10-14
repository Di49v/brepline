# Brepline Backend API

An asynchronous, multi-agent Text-to-CAD generation API built with FastAPI, LangGraph, and CadQuery.

## Architecture Highlights
- **LangGraph Orchestrator:** Uses a DAG to separate intent analysis, JSON specification, and code generation into isolated LLM calls.
- **Subprocess Sandboxing:** Compiles OpenCascade geometry in memory-limited (`RLIMIT_AS`) child processes to prevent kernel segfaults from crashing the web server.
- **Semantic Caching:** Uses Supabase `pgvector` to bypass LLM generation for common foundational shapes (e.g., standard hex nuts, washers).

## Setup & Execution
1. Install dependencies via `uv`:
   ```bash
   uv sync

```

2. Configure `.env` with Groq, Ollama, and Cloudflare Tunnel credentials.
3. Start the server:
```bash
uv run uvicorn app.main:app --reload --port 7860

```

## Testing

Run the strictly-typed Pytest suite:

```bash
uv run pytest tests/ -v

```