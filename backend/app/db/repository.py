import uuid
import logging
from typing import Dict, Any, Optional, List
from app.db.client import get_supabase_client

logger = logging.getLogger("uvicorn.error")


def _to_db_uuid(job_id: Optional[str]) -> Optional[str]:
    """
    Converts a 12-char hex job_id (e.g. '7da3db232323') into a valid 36-char
    PostgreSQL UUID ('00000000-0000-0000-0000-7da3db232323') for `uuid` columns.
    """
    if not job_id:
        return None
    clean = str(job_id).strip().lower().replace("-", "")
    if len(clean) == 12:
        return f"00000000-0000-0000-0000-{clean}"
    try:
        return str(uuid.UUID(clean))
    except ValueError:
        # Deterministic fallback UUID from arbitrary string
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, clean))


def _from_db_uuid(db_uuid: Optional[str]) -> str:
    """Recovers the 12-char hex job_id from the padded PostgreSQL UUID."""
    if not db_uuid:
        return ""
    s = str(db_uuid).strip().lower()
    if s.startswith("00000000-0000-0000-0000-") and len(s) == 36:
        return s[-12:]
    return s.replace("-", "")[-12:]


class CadRepository:
    def __init__(self):
        self.client = get_supabase_client()

    def save_generation(self, record: Dict[str, Any]) -> None:
        """Persists a completed CAD generation job (including 3D mesh & physics) to PostgreSQL."""
        try:
            raw_job = record.get("job")
            db_job_id = _to_db_uuid(raw_job)
            db_parent_id = _to_db_uuid(record.get("parent_job")) if record.get("parent_job") else None

            payload = {
                "job_id": db_job_id,
                "source": record.get("source", "user"),
                "prompt": record.get("prompt") or "CAD Design",
                "material": record.get("material") or "Al 6061",
                "route": record.get("route") or "iterative_assembly",
                "is_edit": bool(record.get("is_edit", False)),
                "parent_job_id": db_parent_id,
                "plan": record.get("plan") or {},
                "code": record.get("code") or "# CAD script",
                "is_ok": bool(record.get("ok", True)),
                "is_verified": bool(record.get("verified", True)),
                "score": int(record.get("score", 10)),
                "issues": record.get("issues", []),
                "metadata": {
                    "short_job_id": raw_job,
                    "bbox": record.get("bbox"),
                    "bbox_min": record.get("bbox_min"),
                    "volume_mm3": record.get("volume_mm3"),
                    "area_mm2": record.get("area_mm2"),
                    "mass_g": record.get("mass_g"),
                    "density_g_cm3": record.get("density_g_cm3"),
                    "com": record.get("com"),
                    "counts": record.get("counts"),
                    "attempts": record.get("attempts", 1),
                    "elapsed_s": record.get("elapsed_s"),
                    "physics": record.get("physics"),
                    "mesh": record.get("mesh"),
                },
                "llm_model": record.get("llm_model") or "gemini-3.8-flash"
            }
            # Upsert ensures if a job ID exists (e.g., a delayed cache flush), it overwrites safely
            self.client.table("generations").upsert(payload, on_conflict="job_id").execute()
            logger.info(f"Saved generation {raw_job} ({db_job_id}) to Supabase `generations` table.")
        except Exception as e:
            logger.error(f"Failed to save generation {record.get('job')}: {e}")

    def get_recent_generations(self, limit: int = 25) -> List[Dict[str, Any]]:
        """Fetches recent successful generations from Supabase to restore chat & file history."""
        try:
            res = (
                self.client.table("generations")
                .select("*")
                .eq("is_ok", True)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            rows = res.data or []
            for r in rows:
                meta = r.get("metadata") or {}
                r["job_id"] = meta.get("short_job_id") or _from_db_uuid(r.get("job_id"))
            return rows
        except Exception as e:
            logger.error(f"Failed to fetch generation history from Supabase: {e}")
            return []

    def get_generation(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a previous generation by 12-char job_id or UUID."""
        try:
            db_id = _to_db_uuid(job_id)
            res = self.client.table("generations").select("*").eq("job_id", db_id).limit(1).execute()
            if not res.data:
                return None
            row = res.data[0]
            meta = row.get("metadata") or {}
            row["job_id"] = meta.get("short_job_id") or _from_db_uuid(row.get("job_id"))
            return row
        except Exception as e:
            logger.error(f"Failed to fetch generation {job_id}: {e}")
            return None

    def save_failure(self, record: Dict[str, Any]) -> None:
        """Persists a failed attempt to PostgreSQL."""
        try:
            payload = {
                "job_id": _to_db_uuid(record.get("job")),
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
                "job_id": _to_db_uuid(job_id),
                "vote": vote,
                "comment": comment[:500],
                "client_ip_hash": ip_hash
            }
            self.client.table("feedback").insert(payload).execute()
        except Exception as e:
            logger.error(f"Failed to save feedback for job {job_id}: {e}")

    def search_similar_cad(self, query_embedding: list[float], threshold: float = 0.70, limit: int = 3) -> list[Dict[str, Any]]:
        """Executes the pgvector similarity search via Supabase RPC."""
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