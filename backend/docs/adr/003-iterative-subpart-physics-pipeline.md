# ADR 003: Iterative Sub-Part Assembly Queue, Dual-Gate Archetype Caching & First-Principles Physics Engine

## Status
Accepted (October 2026)

## Context
Monolithic single-script CAD generation fails on complex multi-part assemblies (e.g., vehicles, rockets, turbofans) due to:
1. LLM output token truncation (`finish_reason == "length"`) when generating 500+ lines of CadQuery + reasoning tokens.
2. Zero sub-part reusability in `pgvector` when entire assemblies are stored as monolithic scripts.
3. Variable collisions and coordinate offsets when attempting to combine cached code snippets.
4. Lack of physical structural verification (crashworthiness, aerodynamic crosswind shear, Euler buckling, and material lightweighting).

## Decision
1. **Per-Model API Key Sharding (`LLMService`):** Maintain an independent round-robin key cursor per `(Provider, Model_Name)` pair so multiple free-tier keys scale RPM/TPM linearly without cross-model contention or sleep delays.
2. **Iterative Sub-Part Queue (`CadOrchestrator`):** Decompose assemblies into 1–4 functional sub-assemblies centered at local `(0,0,0)`. Build, compile, and auto-cache each sub-part individually under a canonical `archetype_tag` (`cylindrical_tube`, `ogive_cone`, `wheel_set`, etc.).
3. **Dual-Gate Archetype Router:** Route to `Agent 2A (Modifier)` only if `similarity >= 0.86` AND the `archetype_tag` matches, preventing slow/erroneous cross-shape modifications.
4. **Namespace-Isolated Stitching (`CadAssembler`):** Encapsulate each sub-part inside `def _build_<id>():` and apply world `position_mm` translations to construct both `parts = {...}` and `result = cq.Compound.makeCompound(...)`.
5. **Analytical B-Rep Physics Engine (`PhysicsEngine`):** Compute exact mass, packing fraction, progressive crush depth (`concrete_wall` vs `bollard_pole`), diagonal crosswind bending stress, 6G Euler buckling, and per-part material optimization in `<5ms`.