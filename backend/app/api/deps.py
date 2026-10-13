import time
from collections import defaultdict, deque
from fastapi import Request, HTTPException, Header, Depends
from app.core.config import settings
from app.db.repository import CadRepository

# In-memory rate limiting state (can be moved to Redis later if multi-worker scaling is needed)
HITS = defaultdict(deque)

def get_client_ip(request: Request) -> str:
    xf = request.headers.get("x-forwarded-for")
    return (xf.split(",")[0].strip() if xf else request.client.host) or "?"

def verify_access_and_rate_limit(
    request: Request, 
    x_access_code: str | None = Header(None)
) -> str:
    """
    Validates the global access code (if set) and enforces the hourly rate limit per IP.
    Returns the client IP hash for feedback tracking.
    """
    if settings.access_code and x_access_code != settings.access_code:
        raise HTTPException(status_code=401, detail="Invalid access code")
    
    ip = get_client_ip(request)
    q = HITS[ip]
    now = time.time()
    
    # Prune hits older than 1 hour
    while q and now - q[0] > 3600:
        q.popleft()
        
    if len(q) >= settings.rate_per_hour:
        raise HTTPException(status_code=429, detail="Rate limit reached, try again later")
        
    q.append(now)
    return ip

def get_repository() -> CadRepository:
    """Dependency injector for the Supabase repository layer."""
    return CadRepository()