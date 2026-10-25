# Brepline Backend Setup

## 1. Prerequisites
- Python >= 3.11
- `uv` (Fast Python package installer and resolver)
- Ollama (running locally for zero-cost LLM and embeddings)
- Supabase Project (PostgreSQL)

## 2. Local Environment Setup

1. **Install Dependencies:**
Navigate to the `backend/` directory and run:
    ```bash
    uv sync
    ```

2. **Configure Environment Variables:**
Copy `.env.example` to `.env` and configure your credentials:
    ```bash
    cp .env.example .env
    ```


*Ensure `SUPABASE_SECRET_KEY` is populated for database write access.*

3. **Start Local LLM:**
In a separate terminal, pull and run the required Ollama models:
    ```bash
    ollama pull qwen2.5-coder
    ollama pull nomic-embed-text
    ```



## 3. Database Initialization

1. Open your Supabase SQL Editor and execute the schema definitions in `docs/adr/` (Vector extension, tables, and `match_cad_examples` RPC).
2. Run the seeding script to populate the vector database with foundational examples:
    ```bash
    uv run python scripts/seed_vectors.py
    ```



## 4. Running the Server

Start the FastAPI application with Uvicorn:

```bash
uv run uvicorn app.main:app --reload --port 7860
```

*The API documentation will be available at `http://localhost:7860/docs`.*

## 5. Running Tests

```bash
uv run pytest tests/ -v

```