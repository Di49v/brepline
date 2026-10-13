# Architecture: LangGraph Multi-Agent CAD Pipeline

## System State (JSON payload passed between nodes)
- `user_prompt`: Raw text input.
- `material`: Extracted constraint (e.g., "Al 6061").
- `target_specs`: Parsed dimensions (bbox, volume).
- `cad_code`: Current iteration of the CadQuery script.
- `error_traceback`: Execution errors (if any).
- `physics_report`: Heuristic mass/durability flags.

## Node 1: The Specifier (Lightweight LLM)
Extracts dimensions, infers missing engineering parameters, and outputs a strict JSON roadmap. If the user says "a strong bracket," it defines wall thickness >5mm.

## Node 2: The Vector Router (pgvector)
Embeds the Specifier's output and queries Supabase.
- **Exact Hit (>95%):** Returns cached code immediately (bypass further LLMs).
- **Partial Hit (70-95%):** Injects the closest matching code into the context for Node 3.
- **Miss (<70%):** Passes empty context to Node 3.

## Node 3: The Coder (Fine-Tuned LLM)
Generates the CadQuery Python script based on the Specifier's constraints and the Vector Router's context.

## Node 4: The Compiler (Tool Node / SandboxExecutor)
Executes the code securely. 
- **If Error:** Routes `error_traceback` back to Node 3 for a targeted repair loop (max 3 retries).
- **If Success:** Routes output metrics to Node 5.

## Node 5: The Physics Heuristic
Multiplies the calculated volume by the material's known density. Checks the bounding box against structural limits. If it fails (e.g., walls too thin for material type), it appends a warning to `physics_report` before final delivery.