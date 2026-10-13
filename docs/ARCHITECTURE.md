# Architecture: Brepline Text-to-CAD API

## Overview
Brepline is an asynchronous FastAPI application that converts natural language constraints or drawn 2D profiles into 3D CAD models (STEP/STL/Mesh) using CadQuery and Large Language Models (LLMs).

## Core Design Principles
1. **Strict Layering (Domain-Driven):** 
   - `api/`: Transport layer. Handles HTTP routing, JWT/Access validation, and rate limiting.
   - `services/`: Business logic. Orchestrates LLMs, caching, and evaluation scoring.
   - `db/`: Data access. Abstracts Supabase/PostgreSQL.
   - `sandbox/`: Execution environment. Strongly isolates C++ OpenCascade execution from the ASGI web server.
2. **Asynchronous Non-Blocking I/O:** All LLM network calls and database writes utilize `asyncio` or FastAPI background tasks to maximize concurrent throughput.
3. **Defense in Depth:** Input shapes are validated via strictly-typed Pydantic v2 models. Executable CadQuery scripts are sanitized via AST parsing and run in subprocesses with OS-level memory/CPU limits (`RLIMIT_AS`, `RLIMIT_CPU`).

## The CAD Pipeline (Orchestrator Flow)
1. **Planning:** A lightweight LLM call creates a JSON specification of the part.
2. **Retrieval:** The orchestrator retrieves top-K matching successful CAD scripts from `examples_lib.py` (later pgvector).
3. **Generation:** `N_CAND` (default 3) candidates are generated concurrently via `asyncio.gather`.
4. **Execution & Evaluation:** Candidates are passed to the `SandboxExecutor`. The AST is validated, the subprocess executes, and bounding box/volume metrics are extracted.
5. **Repair Loop:** If candidates fail or score low, the orchestrator feeds the `cadquery` error traceback back to the LLM for a targeted fix up to `REPAIRS` times.
6. **Persistence:** The winning run (and all failures) are written asynchronously to Supabase.

## Tech Stack
- **Web Server:** Uvicorn + FastAPI
- **Validation:** Pydantic v2 + Pydantic Settings
- **Database:** Supabase PostgreSQL (via `supabase-py`)
- **CAD Engine:** CadQuery (OpenCascade)
- **Tooling:** `uv`