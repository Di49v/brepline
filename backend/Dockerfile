FROM python:3.11-slim

# Install system dependencies required by CadQuery / OpenCASCADE C++ engine
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install uv for ultra-fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy dependency definition files first for optimal Docker layer caching
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy the rest of the backend application code
COPY . .

# Ensure the sandbox output directory exists
RUN mkdir -p /app/out

# Expose port
EXPOSE 7860

# Use sh -c so ${PORT:-7860} expands on Render (10000), Railway, and local Docker (7860)
CMD ["sh", "-c", "uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]