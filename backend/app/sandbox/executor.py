import os
import sys
import json
import logging
import asyncio
from typing import Dict, Any
from app.core.config import settings

logger = logging.getLogger(__name__)

# Semaphore to strictly limit how many CadQuery OpenCascade instances run simultaneously (Memory control)
CAD_SEMAPHORE = asyncio.Semaphore(settings.cad_workers)

class SandboxExecutor:
    """Handles the isolated execution of generated CadQuery Python scripts."""
    
    def __init__(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.runner_path = os.path.join(self.base_dir, "runner.py")
        os.makedirs(settings.out_dir, exist_ok=True)

    def _make_preexec(self):
        """Resource limits for the child. Linux only. Prevents memory leaks from killing the FastAPI server."""
        try:
            import resource
            if not sys.platform.startswith("linux"):
                return None
            def limits():
                mem = settings.cad_mem_limit_mb * 1024 * 1024
                try:
                    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
                    resource.setrlimit(resource.RLIMIT_CPU, (settings.cad_timeout_seconds + 10, settings.cad_timeout_seconds + 10))
                except (ValueError, OSError):
                    pass
            return limits
        except ImportError:
            return None

    async def run_code(self, code: str, wd: str, timeout: int = None) -> Dict[str, Any]:
        """Runs the CAD script asynchronously in a sandboxed subprocess."""
        timeout = timeout or settings.cad_timeout_seconds
        os.makedirs(wd, exist_ok=True)
        
        script_path = os.path.join(wd, "model.py")
        with open(script_path, "w") as f:
            f.write(code)

        # Strip LLM/DB credentials from the child process environment
        safe_env = {k: v for k, v in os.environ.items() if not k.startswith(("LLM_", "ACCESS_", "ADMIN_", "SUPABASE_"))}

        async with CAD_SEMAPHORE:
            try:
                # Use asyncio.create_subprocess_exec for non-blocking IO
                process = await asyncio.create_subprocess_exec(
                    sys.executable, self.runner_path, script_path, wd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=safe_env,
                    preexec_fn=self._make_preexec(),
                    start_new_session=True
                )
                
                try:
                    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
                except asyncio.TimeoutError:
                    process.kill()
                    return {"ok": False, "error": f"Timeout after {timeout}s (model too complex)"}
                    
                meta_path = os.path.join(wd, "meta.json")
                if os.path.exists(meta_path):
                    try:
                        with open(meta_path, "r") as f:
                            return json.load(f)
                    except json.JSONDecodeError:
                        pass
                
                err_out = (stderr.decode() if stderr else "")[-600:]
                return {"ok": False, "error": f"Runner crashed (rc={process.returncode}): {err_out}"}

            except Exception as e:
                logger.error(f"Sandbox execution failed: {e}")
                return {"ok": False, "error": f"Could not start sandbox: {e}"}