"""
Brepline local backend (no database).
Run:  MODEL_URL=https://your-tunnel.trycloudflare.com/v1 uvicorn main:app --reload --port 8000
"""
import os, json, time, secrets, hashlib, threading
from pathlib import Path
from collections import defaultdict, deque

import httpx
try:
    from dotenv import load_dotenv
    load_dotenv(override=True)   # .env wins over stale terminal variables
except ImportError:
    pass
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

MODEL_URL = os.environ.get("MODEL_URL", "").rstrip("/")   # must end with /v1
MODEL_NAME = os.environ.get("MODEL_NAME", "")             # optional, auto-detected if empty
MODEL_API_KEY = os.environ.get("MODEL_API_KEY", "none")   # only if your server needs one
RATE_LIMIT = int(os.environ.get("RATE_LIMIT", "10"))      # requests per minute per key
CREDITS = 50

DB_FILE = Path(__file__).parent / "keys.json"
_lock = threading.Lock()
_hits = defaultdict(deque)      # key_id -> timestamps (rate limit)
_latencies = deque(maxlen=100)  # recent latencies in seconds
_stats = {"playground": 0}

app = FastAPI(title="Brepline local API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"], allow_headers=["*"],
)

# ---------------- tiny JSON "database" ----------------
def load():
    db = json.loads(DB_FILE.read_text()) if DB_FILE.exists() else {}
    db.setdefault("keys", [])
    db.setdefault("generations", [])
    return db

def save(db):
    DB_FILE.write_text(json.dumps(db, indent=2))

def sha(s): return hashlib.sha256(s.encode()).hexdigest()

def public(k):
    return {"id": k["id"], "name": k["name"], "prefix": k["prefix"], "last4": k.get("last4", ""),
            "env": k.get("env", "live"), "scopes": k.get("scopes", ["generate", "read", "usage"]),
            "created": k["created"], "used": k["used"], "last_used": k["last_used"]}

def auth(authorization: str, scope: str = None):
    raw = authorization.removeprefix("Bearer ").strip()
    if not raw:
        raise HTTPException(401, "Missing API key")
    with _lock:
        db = load()
        for k in db["keys"]:
            if k["hash"] == sha(raw):
                if scope and k.get("scopes") and scope not in k["scopes"]:
                    raise HTTPException(403, f"This key does not have the '{scope}' permission")
                # rate limit
                now = time.time()
                q = _hits[k["id"]]
                while q and now - q[0] > 60:
                    q.popleft()
                if len(q) >= RATE_LIMIT:
                    raise HTTPException(429, f"Rate limit: {RATE_LIMIT} requests/min")
                q.append(now)
                k["used"] += 1
                k["last_used"] = int(now)
                save(db)
                return k
    raise HTTPException(401, "Invalid API key")

def record(source, body, output, model):
    """Save every generation so the Generations page has history."""
    with _lock:
        db = load()
        db["generations"].insert(0, {
            "id": secrets.token_hex(4), "created": int(time.time()), "source": source,
            "prompt": body.get("prompt", ""), "material": body.get("material"),
            "format": body.get("format"), "output": output, "model": model})
        db["generations"] = db["generations"][:200]
        save(db)

# ---------------- model calls ----------------
async def model_name(client):
    global MODEL_NAME
    if MODEL_NAME:
        return MODEL_NAME
    r = await client.get(f"{MODEL_URL}/models", headers={"Authorization": f"Bearer {MODEL_API_KEY}"})
    MODEL_NAME = r.json()["data"][0]["id"]
    return MODEL_NAME

async def chat(messages, **extra):
    """Works with servers that stream (SSE) AND servers that ignore stream and return one JSON."""
    if not MODEL_URL:
        raise HTTPException(500, "MODEL_URL env var is not set")
    extra.setdefault("max_tokens", int(os.environ.get("MAX_TOKENS", "200")))
    t0 = time.time()
    parts, model, raw = [], None, []
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=15)) as c:
            payload = {"model": await model_name(c), "messages": messages, **extra, "stream": True}
            async with c.stream("POST", f"{MODEL_URL}/chat/completions", json=payload,
                                headers={"Authorization": f"Bearer {MODEL_API_KEY}"}) as r:
                if r.status_code != 200:
                    body = (await r.aread()).decode(errors="ignore")[:300]
                    raise HTTPException(502, f"Model error {r.status_code}: {body}")
                if "text/event-stream" not in r.headers.get("content-type", ""):
                    # server ignored stream=true and sent one JSON object
                    body = await r.aread()
                    try:
                        j = json.loads(body)
                        model = j.get("model")
                        parts.append(j["choices"][0]["message"]["content"] or "")
                    except (ValueError, KeyError, IndexError, TypeError):
                        raw.append(body.decode(errors="ignore")[:200])
                else:
                    async for line in r.aiter_lines():
                        if len(raw) < 5 and line.strip():
                            raw.append(line[:200])
                        if not line.startswith("data:"):
                            continue
                        d = line[5:].strip()
                        if d == "[DONE]":
                            break
                        try:
                            j = json.loads(d)
                        except ValueError:
                            continue
                        model = j.get("model", model)
                        ch = j.get("choices") or []
                        if ch:
                            parts.append((ch[0].get("delta") or {}).get("content") or "")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Model unreachable (is the Kaggle tunnel alive?): {e}")
    if not "".join(parts):
        raise HTTPException(502, f"Model returned an empty answer after {round(time.time()-t0)}s. "
                                 f"First lines received: {raw or 'nothing'}")
    _latencies.append(time.time() - t0)
    return {"model": model, "choices": [{"message": {"role": "assistant", "content": "".join(parts)}}]}

def build_messages(body):
    prompt = body.get("prompt")
    if not prompt:
        raise HTTPException(422, "'prompt' is required")
    extras = [f"{k}: {body[k]}" for k in ("material", "format", "units") if body.get(k)]
    text = prompt + ("\n\n" + "\n".join(extras) if extras else "")
    return [{"role": "user", "content": text}]

# ---------------- portal endpoints (used by the React app) ----------------
@app.get("/api/health")
async def health():
    if not MODEL_URL:
        return {"ok": False, "reason": "MODEL_URL not set"}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{MODEL_URL}/models", headers={"Authorization": f"Bearer {MODEL_API_KEY}"})
        if r.status_code == 200:
            return {"ok": True}
        return {"ok": False, "reason": f"model server answered HTTP {r.status_code}"}
    except Exception as e:
        return {"ok": False, "reason": f"{type(e).__name__}: {e}"}

@app.get("/api/keys")
def list_keys():
    return {"keys": [public(k) for k in load()["keys"]]}

@app.post("/api/keys")
def create_key(body: dict):
    env = body.get("env") if body.get("env") in ("live", "test") else "live"
    raw = f"bp_{env}_" + secrets.token_urlsafe(32)
    k = {"id": secrets.token_hex(4), "name": body.get("name") or "Untitled key",
         "env": env, "scopes": body.get("scopes") or ["generate", "read", "usage"],
         "prefix": raw[:12], "last4": raw[-4:], "hash": sha(raw), "created": int(time.time()),
         "used": 0, "last_used": None}
    with _lock:
        db = load(); db["keys"].append(k); save(db)
    return {**public(k), "key": raw}   # full key is returned ONLY here

@app.delete("/api/keys/{key_id}")
def delete_key(key_id: str):
    with _lock:
        db = load()
        db["keys"] = [k for k in db["keys"] if k["id"] != key_id]
        save(db)
    return {"deleted": key_id}

@app.get("/api/usage")
def usage():
    keys = load()["keys"]
    used = sum(k["used"] for k in keys) + _stats["playground"]
    avg = round(sum(_latencies) / len(_latencies), 1) if _latencies else 0
    return {"credits_used": used, "credits_total": CREDITS, "active_keys": len(keys),
            "rate_limit": RATE_LIMIT, "avg_latency": avg}

@app.post("/api/playground")          # no key needed, for testing from the portal
async def playground(body: dict):
    data = await chat(build_messages(body))
    _stats["playground"] += 1
    out = data["choices"][0]["message"]["content"]
    record("playground", body, out, data.get("model"))
    return {"output": out, "model": data.get("model")}

# ---------------- public API (what your users call with a key) ----------------
@app.post("/v1/generate")
async def generate(body: dict, authorization: str = Header("")):
    auth(authorization, "generate")
    data = await chat(build_messages(body))
    out = data["choices"][0]["message"]["content"]
    record("api", body, out, data.get("model"))
    return {"output": out, "model": data.get("model"), "usage": data.get("usage")}

@app.post("/v1/chat/completions")     # OpenAI-compatible: works with the OpenAI SDK
async def completions(body: dict, authorization: str = Header("")):
    auth(authorization, "generate")
    body.pop("model", None)           # we pick the model
    msgs = body.pop("messages", [])
    return await chat(msgs, **body)


# ---------------- extra pages: Generations, Models, Status ----------------
@app.get("/api/generations")
def generations():
    return {"generations": load()["generations"]}

@app.delete("/api/generations")
def clear_generations():
    with _lock:
        db = load(); db["generations"] = []; save(db)
    return {"cleared": True}

@app.get("/api/models")
async def models():
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"{MODEL_URL}/models", headers={"Authorization": f"Bearer {MODEL_API_KEY}"})
        return {"models": [m["id"] for m in r.json()["data"]]}
    except Exception:
        return {"models": []}

@app.get("/api/status")
async def status():
    h = await health()
    return {"api": "operational", "engine": "operational" if h["ok"] else "down",
            "avg_latency": round(sum(_latencies) / len(_latencies), 1) if _latencies else 0}