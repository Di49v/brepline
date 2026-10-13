import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings

client = TestClient(app)

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert "cadquery_installed" in data

def test_create_job_missing_auth():
    # Force access code requirement for test
    settings.access_code = "secret123"
    
    response = client.post(
        "/api/jobs",
        json={"prompt": "make a 10mm hex nut", "material": "Steel"}
    )
    assert response.status_code == 401
    
    # Clean up
    settings.access_code = ""

def test_shape_validation_schema():
    # Test valid schema
    valid_payload = {
        "spec": {
            "type": "polygon",
            "points": [[0,0], [10,0], [10,10], [0,10]],
            "thickness": 5.0
        }
    }
    response = client.post("/api/shape/validate", json=valid_payload)
    assert response.status_code == 200
    assert response.json()["ok"] is True

    # Test invalid schema (missing required fields)
    invalid_payload = {"spec": {}}
    response = client.post("/api/shape/validate", json=invalid_payload)
    assert response.json()["ok"] is False