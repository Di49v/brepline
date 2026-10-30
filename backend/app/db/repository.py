import os
import json
import uuid
import logging
from typing import Dict, Any, Optional, List
from app.db.client import get_supabase_client
from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

LOCAL_HISTORY_FILE = os.path.join(settings.out_dir, "history_index.json")


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
    """
    Dual-Persistence CAD Repository (Supabase PostgreSQL + Local Disk Index).
    Guarantees zero history loss across Uvicorn reloads and browser restarts.
    """

    def __init__(self):
        self.client = get_supabase_client()
        os.makedirs(settings.out_dir, exist_ok=True)

    def _save_local_backup(self, record: Dict[str, Any]) -> None:
        """Saves generation record to `out/history_index.json` so Uvicorn reloads never lose history."""
        try:
            existing: List[Dict[str, Any]] = []
            if os.path.exists(LOCAL_HISTORY_FILE):
                with open(LOCAL_HISTORY_FILE, "r", encoding="utf-8") as f:
                    existing = json.load(f) or []

            job_id = record.get("job")
            existing = [r for r in existing if r.get("job") != job_id]
            existing.insert(0, {
                "job": job_id,
                "prompt": record.get("prompt") or "CAD Design",
                "material": record.get("material") or "Al 6061",
                "route": record.get("route") or "iterative_assembly",
                "plan": record.get("plan") or {},
                "code": record.get("code") or "",
                "ok": bool(record.get("ok", True)),
                "verified": bool(record.get("verified", True)),
                "bbox": record.get("bbox") or [100, 100, 100],
                "bbox_min": record.get("bbox_min"),
                "volume_mm3": record.get("volume_mm3"),
                "area_mm2": record.get("area_mm2"),
                "mass_g": record.get("mass_g"),
                "density_g_cm3": record.get("density_g_cm3"),
                "com": record.get("com"),
                "counts": record.get("counts"),
                "physics": record.get("physics"),
                "mesh": record.get("mesh"),
            })
            with open(LOCAL_HISTORY_FILE, "w", encoding="utf-8") as f:
                json.dump(existing[:25], f)
        except Exception as e:
            logger.warning(f"Local history backup warning: {e}")

    def _load_local_backup(self) -> List[Dict[str, Any]]:
        if not os.path.exists(LOCAL_HISTORY_FILE):
            return []
        try:
            with open(LOCAL_HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or []
        except Exception:
            return []

    def save_generation(self, record: Dict[str, Any]) -> None:
        """Persists a completed CAD generation job to both local disk index and Supabase PostgreSQL."""
        # 1. Always write instant local backup first
        self._save_local_backup(record)

        # 2. Persist to Supabase `public.generations`
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
            logger.error(f"Supabase `generations` insert failed for {record.get('job')} (local backup active): {e}")

    def get_recent_generations(self, limit: int = 25) -> List[Dict[str, Any]]:
        """Merges Supabase `generations` with local disk backup so history always loads."""
        merged: Dict[str, Dict[str, Any]] = {}

        # 1. Load from local disk backup first
        for loc in self._load_local_backup():
            jid = loc.get("job")
            if jid and loc.get("mesh"):
                merged[jid] = {
                    "job_id": jid,
                    "prompt": loc.get("prompt"),
                    "material": loc.get("material"),
                    "code": loc.get("code"),
                    "plan": loc.get("plan"),
                    "is_verified": loc.get("verified", True),
                    "metadata": loc,
                }

        # 2. Load from Supabase PostgreSQL
        try:
            res = (
                self.client.table("generations")
                .select("*")
                .eq("is_ok", True)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            for r in (res.data or []):
                meta = r.get("metadata") or {}
                jid = meta.get("short_job_id") or _from_db_uuid(r.get("job_id"))
                r["job_id"] = jid
                if jid and meta.get("mesh"):
                    merged[jid] = r
        except Exception as e:
            logger.warning(f"Supabase history fetch fallback to local backup: {e}")

        return list(merged.values())[:limit]

    def get_generation(self, job_id: str) -> Optional[Dict[str, Any]]:
        for loc in self._load_local_backup():
            if loc.get("job") == job_id:
                return {
                    "job_id": job_id,
                    "prompt": loc.get("prompt"),
                    "material": loc.get("material"),
                    "code": loc.get("code"),
                    "plan": loc.get("plan"),
                    "is_verified": loc.get("verified", True),
                    "metadata": loc,
                }
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