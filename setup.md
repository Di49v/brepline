# Team Onboarding & Setup Guide

This guide provides end-to-end instructions for running Brepline locally on Windows, macOS, or Linux.

---

## 1. System Prerequisites

Ensure you have the following installed:
- **Python >= 3.11**
- **Node.js >= 18.0**
- **uv** (Extremely fast Python package manager):
  - *Windows (PowerShell):* `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
  - *macOS/Linux:* `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Ollama** (Local LLM runner): [Install Ollama](https://ollama.ai)

---

## 2. Ollama Local Model Setup

Open a terminal and pull the local reasoning and embedding models:

```bash
# 1. Reasoning & Coder fallback model
ollama pull qwen2.5-coder:7b

# 2. Embedding model for semantic search (pgvector)
ollama pull nomic-embed-text

```

> **Note:** `nomic-embed-text` is an embedding-only model. Running `ollama run nomic-embed-text` directly in terminal will return `does not support generate`. That is expected behavior. The backend calls its embedding API endpoint directly.

---

## 3. Supabase Database Configuration

Brepline uses Supabase PostgreSQL with `pgvector` for semantic caching.

1. Open your Supabase project dashboard.
2. Go to the **SQL Editor** and execute the following SQL to enable extensions and setup the vector tables:

```sql
-- 1. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create the example template table
CREATE TABLE IF NOT EXISTS cad_examples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tags TEXT[],
    prompt TEXT NOT NULL,
    code TEXT NOT NULL,
    embedding vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create HNSW index for high-speed cosine distance search
CREATE INDEX IF NOT EXISTS cad_examples_embedding_idx 
ON cad_examples USING hnsw (embedding vector_cosine_ops);

-- 4. Create the RPC function for vector similarity matching
CREATE OR REPLACE FUNCTION match_cad_examples (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  tags text[],
  prompt text,
  code text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    cad_examples.id,
    cad_examples.tags,
    cad_examples.prompt,
    cad_examples.code,
    1 - (cad_examples.embedding <=> query_embedding) AS similarity
  FROM cad_examples
  WHERE 1 - (cad_examples.embedding <=> query_embedding) > match_threshold
  ORDER BY cad_examples.embedding <=> query_embedding
  LIMIT match_count;
$$;

```

---

## 4. Backend Configuration (`/backend`)

### A. Environment File

Create `backend/.env` based on the template below:

```env
# Application Environment
ENVIRONMENT=development
ALLOWED_ORIGINS=http://localhost:5173,[http://127.0.0.1:5173](http://127.0.0.1:5173)

# API Security
ACCESS_CODE=brepline-2
ADMIN_TOKEN=test_admin_token

# Local Reasoning & Specifier (Ollama)
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5-coder:7b

# Coding Agent (Ollama Local or Cluster Tunnel)
CODER_BASE_URL=http://localhost:11434/v1
CODER_API_KEY=ollama
CODER_MODEL=qwen2.5-coder:7b

# (Optional) Cloud Planner (Groq) - Leave blank if running 100% locally
PLAN_BASE_URL=
PLAN_API_KEY=
PLAN_MODEL=

# Execution Sandbox Limits
OUT_DIR=/tmp/cad_out
CAD_WORKERS=2
CAD_TIMEOUT=180
CAD_MEM_MB=4096
RATE_PER_HOUR=60
MAX_CONCURRENT_JOBS=2

# Supabase Credentials (Use the SECRET service_role key for backend writes)
SUPABASE_URL=https://<your-project-id>.supabase.co
SUPABASE_SECRET_KEY=<your-service-role-key>

# LangSmith Observability (Optional)
LANGCHAIN_TRACING_V2=false
LANGCHAIN_ENDPOINT=[https://api.smith.langchain.com](https://api.smith.langchain.com)
LANGCHAIN_API_KEY=
LANGCHAIN_PROJECT=brepline_multi_agent

```

### B. Dependencies & Database Seeding

Navigate to the `backend/` directory in your terminal:

```bash
cd backend

# Install all Python dependencies via uv
uv sync

# Seed the Supabase database with foundational CAD templates
uv run python scripts/seed_vectors.py

```

### C. Run the Backend Tests

Run the test suite to ensure the routes, schemas, and sandbox configurations pass:

```bash
uv run pytest tests/ -v

```

### D. Start the API Server

```bash
uv run uvicorn app.main:app --reload --port 7860

```

The backend will be live at `http://localhost:7860`. Interactive Swagger API docs are available at `http://localhost:7860/docs`.

---

## 5. Frontend Configuration (`/frontend`)

Open a separate terminal window:

```bash
cd frontend

# Install Node dependencies
npm install

```

### A. Environment Configuration

Verify or create `frontend/.env`:

```env
VITE_API_URL=http://localhost:7860
VITE_ACCESS_CODE=brepline-2

```

### B. Start the Vite Development Server

```bash
npm run dev

```

Open `http://localhost:5173` in your browser.

---

## 6. Using the Cluster/Tunnel Model (For Team Testing)

When testing with the fine-tuned DeepCAD model hosted on the Pegasus cluster:

1. Obtain the active Tunnel URL (Cloudflare/Ngrok) from the team lead.
2. In `backend/.env`, update:
```env
CODER_BASE_URL=https://<active-tunnel-url>[.trycloudflare.com/v1](https://.trycloudflare.com/v1)
CODER_API_KEY=cluster_secret_token
CODER_MODEL=fine-tuned-deepcad

```


3. Save the file. Uvicorn hot-reloads automatically. Subsequent CAD generations will route code generation through the cluster while preserving local planning and vector caching.

---

## 7. Troubleshooting

```plaintext
| Issue | Cause | Fix |
| --- | --- | --- |
| `pydantic_settings.exceptions.SettingsError: error parsing value for field allowed_origins` | String format mismatch | Ensure `ALLOWED_ORIGINS` in `backend/.env` is a comma-separated string without quotation brackets. |
| `ImportError: cannot import name 'profiles'` | Missing `__init__.py` markers | Run `touch backend/app/__init__.py backend/app/services/__init__.py`. |
| `Couldn't build this part / timed out` | LLM or subprocess execution blocked | Check if Ollama is running (`curl http://localhost:11434/api/tags`). Verify `qwen2.5-coder:7b` is pulled. |
| UI shows `Engine offline` | Port mismatch or CORS failure | Ensure backend is on port `7860` and `VITE_API_URL` points to `http://localhost:7860`. |

```