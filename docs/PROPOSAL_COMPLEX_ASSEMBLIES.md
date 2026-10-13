# Architectural Proposal: Hierarchical Multi-Agent CAD & Physics Engine

## 1. Executive Summary
This document outlines the evolutionary roadmap from Brepline's baseline atomic text-to-CAD generator to an enterprise-grade, multi-agent engine capable of decomposing complex natural-language requests into multi-part mechanical assemblies, enforcing manufacturing constraints, and conducting structural durability audits.

---

## 2. System Architecture & Agent Roles

```mermaid
graph TD
    User([User Prompt / Uploaded CAD]) --> Gateway[API Gateway & Controller]
    
    subgraph Planning & Decomposition
        Gateway --> Specifier[Agent 1: Specifier & Decomposer]
        Specifier --> BOM[(Structured BOM & Interface Graph)]
    end

    subgraph Geometry Engine
        BOM --> Router{Semantic Cache Check}
        Router -->|Similarity > 85%| Modifier[Agent 2A: Parametric Modifier]
        Router -->|Similarity < 85%| Coder[Agent 2B: Atomic CAD Coder]
        Modifier --> Compiler[Sandbox Compiler & Tessellator]
        Coder --> Compiler
        Compiler -->|Syntax/Kernel Error| Repair[Repair Feedback Loop]
        Repair --> Coder
    end

    subgraph Assembly & Integration
        Compiler -->|Validated STEP Parts| Assembler[Agent 3: Assembly Integrator]
        Assembler --> AssemblyModel[(cq.Assembly / Master STEP)]
    end

    subgraph Analysis Layer
        Gateway -.->|Uploaded STEP/STL| Auditor
        AssemblyModel --> Auditor[Agent 4: Physics & Durability Auditor]
        Auditor --> SimReport[Stress, Mass & Tolerance Report]
    end

    SimReport --> FinalOutput([Export: STEP, STL, Interactive 3D & Report])

```

---

## 3. Detailed Agent Specifications

### Agent 1: The Specifier & Decomposer

* **Input:** Natural language prompt (e.g., *"Design a scissor lift mechanism for a 5 kg load with 150 mm maximum stroke"*).
* **Role:** Acts as the Chief Mechanical Engineer. Deconstructs the prompt into:
1. **Bill of Materials (BOM):** List of discrete parts (Base, Links, Pins, Platform).
2. **Interface Contract:** Global shared variables ensuring mate compatibility:
```json
{
  "shared_interfaces": {
    "pin_diameter": 6.0,
    "hole_clearance": 6.2,
    "link_thickness": 4.0
  },
  "parts": [
    {"id": "link_arm", "qty": 4, "type": "plate_with_holes"},
    {"id": "pivot_pin", "qty": 6, "type": "pin"}
  ]
}
```
* **Output:** A Directed Acyclic Graph (DAG) of parts and mating references.

---

### Agent 2: Geometry Generation (Coder & Modifier)

* **Parametric Modifier (Cache Hit):** Takes pre-verified CadQuery scripts from Supabase `pgvector` and substitutes parameter values according to the Interface Contract.
* **Atomic Coder (Cache Miss):** Uses instruction-tuned models with few-shot context to generate clean, single-solid CadQuery code.
* **Sandbox Verification:** Every component is executed through `runner.py` inside an OS-level isolated subprocess (`RLIMIT_AS` memory clamping). If OpenCascade fails, the traceback is routed back to the Coder for a maximum of 3 repair attempts.

---

### Agent 3: Assembly Integrator

* **Input:** Validated individual `.step` geometry files + Interface Contract from Agent 1.
* **Role:** Constructs an assembly tree using CadQuery's native `cq.Assembly()` API:
```python
import cadquery as cq

assy = cq.Assembly()
assy.add(base_plate, name="base", color=cq.Color(0.2, 0.2, 0.2))
assy.add(link_1, name="link_1", loc=cq.Location(cq.Vector(0, 0, 10)))
assy.save("master_model.step")

```


* **Output:** A unified multi-body `.step` file and a joint-hierarchy JSON tree for client-side Three.js visualization.

---

### Agent 4: Physics & Durability Auditor (Independent Service)

* **Input:** Assembled mechanism or user-uploaded CAD file (`.step`/`.stl`) + Material specifications.
* **Analysis Pipeline:**
1. **Geometric Diagnostics (Trimesh):** Checks for zero-thickness walls, degenerate facets, center of gravity (CoG), and bounding envelopes.
2. **Analytical Stress Checks:**
* Tensile and shear stress at connection points: $\sigma = \frac{F}{A}$, $\tau = \frac{F}{A}$.
* Fastener shear margins against material yield strength ($S_y$).
* Thin-wall buckling checks on structural columns under compressive loads.


3. **Durability Scorecard:** Outputs a safety factor ($SF = \frac{S_y}{\sigma_{\text{max}}}$) and flags high-risk geometric stress concentrators (sharp internal corners without fillets).