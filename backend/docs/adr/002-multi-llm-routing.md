# ADR 002: Multi-LLM Routing and Hardware Offloading

## Status
Accepted

## Context
The CAD pipeline requires two distinct types of reasoning: high-speed linguistic/JSON parsing (Specifier) and deep spatial code generation (Coder). Relying on a single local GPU for both creates severe bottlenecks.

## Decision
We utilize the `AsyncOpenAI` client to route requests across three distinct endpoints dynamically:
1. **Groq (`PLAN_BASE_URL`):** Utilizes `llama3-70b` for near-instantaneous natural language to JSON decomposition (Agents 0 & 1).
2. **Cluster Tunnel (`CODER_BASE_URL`):** Routes strictly to a custom fine-tuned DeepCAD model for CadQuery syntax generation (Agent 2).
3. **Ollama (`LLM_BASE_URL`):** Serves as a zero-cost local fallback and generates `nomic-embed-text` vectors for the pgvector semantic cache.

## Consequences
Reduces local RAM pressure, decreases end-to-end generation latency by ~40%, and isolates CAD hallucinations to the fine-tuned model.