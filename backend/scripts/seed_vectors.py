import os
import asyncio
import logging
from openai import AsyncOpenAI
from supabase import create_client
from dotenv import load_dotenv

# Load the examples from your existing library
from examples_lib import EXAMPLES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables from backend/.env
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
OLLAMA_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")

# Initialize Clients
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
llm_client = AsyncOpenAI(base_url=OLLAMA_BASE_URL, api_key="ollama")

async def get_embedding(text: str) -> list[float]:
    """Fetches a vector embedding from the local Ollama instance."""
    response = await llm_client.embeddings.create(
        model="nomic-embed-text",
        input=text
    )
    return response.data[0].embedding

async def seed_database():
    logger.info(f"Starting seeding process for {len(EXAMPLES)} examples...")
    
    for tags, prompt, code in EXAMPLES:
        logger.info(f"Embedding prompt: '{prompt[:40]}...'")
        
        try:
            # We embed the prompt along with its tags to increase semantic surface area
            combined_text = f"Tags: {', '.join(tags)}. Description: {prompt}"
            embedding = await get_embedding(combined_text)
            
            payload = {
                "tags": tags,
                "prompt": prompt,
                "code": code,
                "embedding": embedding
            }
            
            # Insert into Supabase
            supabase.table("cad_examples").insert(payload).execute()
            logger.info("Successfully inserted.")
            
        except Exception as e:
            logger.error(f"Failed to process example: {e}")

    logger.info("Seeding complete.")

if __name__ == "__main__":
    asyncio.run(seed_database())