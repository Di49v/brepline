import logging
from typing import Dict, Any, Optional, List
from app.db.client import get_supabase_client

logger = logging.getLogger(__name__)

class CadRepository:
    def __init__(self):
        self.client = get_supabase_client()

    def save_generation(self, record: Dict[str, Any]) -> None:
        """Persists a completed CAD generation job to PostgreSQL."""
        try:
            payload = {
                "job_id": record.get("job"),
                "source": record.get("source", "user"),
                "prompt": record.get("prompt"),
                "material": record.get("material"),
                "route": record.get("route"),
                "is_edit": record.get("is_edit", False),
                "parent_job_id": record.get("parent_job") if record.get("parent_job") else None,
                "plan": record.get("plan"),
                "code": record.get("code"),
                "is_ok": record.get("ok", False),
                "is_verified": record.get("verified", False),
                "score": record.get("score", 0),
                "issues": record.get("issues", []),
                "metadata": {
                    "bbox": record.get("bbox"),
                    "volume_mm3": record.get("volume_mm3"),
                    "mass_g": record.get("mass_g"),
                    "attempts": record.get("attempts"),
                    "elapsed_s": record.get("elapsed_s"),
                    "physics": record.get("physics")
                },
                "llm_model": record.get("llm_model")
            }
            # Upsert ensures if a job ID exists (e.g., a delayed cache flush), it overwrites safely
            self.client.table("generations").upsert(payload).execute()
        except Exception as e:
            logger.error(f"Failed to save generation {record.get('job')}: {e}")

    def get_generation(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a previous generation by job_id for conversational refinement."""
        try:
            res = self.client.table("generations").select("*").eq("job_id", job_id).limit(1).execute()
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error(f"Failed to fetch generation {job_id}: {e}")
            return None

    def save_failure(self, record: Dict[str, Any]) -> None:
        """Persists a failed attempt to PostgreSQL."""
        try:
            payload = {
                "job_id": record.get("job"),
                "prompt": record.get("prompt"),
                "code": record.get("code"),
                "stage": record.get("stage"),
                "score": record.get("score", 0),
                "issues": record.get("issues", [])
            }
            self.client.table("failures").insert(payload).execute()
        except Exception as e:
            logger.error(f"Failed to save failure for job {record.get('job')}: {e}")

    def save_feedback(self, job_id: str, vote: str, comment: str, ip_hash: str) -> None:
        """Persists user feedback on a generation."""
        try:
            payload = {
                "job_id": job_id,
                "vote": vote,
                "comment": comment[:500],  # Enforcement of DB limits
                "client_ip_hash": ip_hash
            }
            self.client.table("feedback").insert(payload).execute()
        except Exception as e:
            logger.error(f"Failed to save feedback for job {job_id}: {e}")

    def search_similar_cad(self, query_embedding: list[float], threshold: float = 0.70, limit: int = 3) -> list[Dict[str, Any]]:
        """
        Executes the pgvector similarity search via Supabase RPC.
        Returns matching CadQuery templates.
        """
        try:
            response = self.client.rpc(
                "match_cad_examples", 
                {"query_embedding": query_embedding, "match_threshold": threshold, "match_count": limit}
            ).execute()
            return response.data or []
        except Exception as e:
            logger.error(f"Vector search failed: {e}")
            return []

    def save_example_to_cache(self, tags: List[str], prompt: str, code: str, embedding: List[float]) -> None:
        """Saves newly verified canonical geometry into cad_examples for future cache hits."""
        try:
            self.client.table("cad_examples").insert({
                "tags": tags,
                "prompt": prompt,
                "code": code,
                "embedding": embedding
            }).execute()
        except Exception as e:
            logger.warning(f"Failed to cache example '{prompt[:40]}': {e}")