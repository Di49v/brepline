import os

# Overwrite test environment variables prior to test imports
os.environ["ENVIRONMENT"] = "development"
os.environ["ADMIN_TOKEN"] = "test_admin_token"
os.environ["SUPABASE_URL"] = "https://test.supabase.co"
os.environ["SUPABASE_KEY"] = "test_SUPABASE_SECRET_key"
os.environ["SUPABASE_SECRET_KEY"] = "test_SUPABASE_SECRET_key"
os.environ["LLM_API_KEY"] = "test_llm_key"
os.environ["LLM_BASE_URL"] = "http://localhost:11434/v1"
os.environ["OUT_DIR"] = "/tmp/cad_out_test"
os.environ["ALLOWED_ORIGINS"] = "*"