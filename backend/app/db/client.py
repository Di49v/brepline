from supabase import create_client, Client
from app.core.config import settings

def get_supabase_client() -> Client:
    """
    Initializes and returns the Supabase PostgreSQL client.
    In a production app, this connection can be cached or managed via dependency injection.
    """
    if not settings.supabase_url or not settings.supabase_key:
        raise ValueError("Supabase URL and Key must be set in environment variables.")
    return create_client(settings.supabase_url, settings.supabase_key)