# ADR 001: Subprocess Isolation for CadQuery Execution

## Status
Accepted

## Context
CadQuery relies on OpenCascade (a heavy C++ CAD kernel). If OpenCascade encounters an invalid boolean geometry operation or runs out of memory on complex meshes, it can segfault. If CadQuery runs natively inside the FastAPI process, a segfault will crash the entire web server, terminating all ongoing requests.

## Decision
We mandate the `SandboxExecutor` pattern. Every generated script is saved to disk and executed via `asyncio.create_subprocess_exec("python", "runner.py")`. We apply POSIX `resource.setrlimit` constraints to strictly bound RAM and CPU time per subprocess.

## Consequences
- **Positive:** A failing or malicious LLM script cannot crash the FastAPI ASGI server. Memory leaks in OpenCascade are isolated and cleaned up upon subprocess termination.
- **Negative:** Subprocess startup overhead (~0.5s) is added to every CAD generation. This is acceptable given LLM generation itself takes 5-15 seconds.