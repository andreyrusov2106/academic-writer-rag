"""
Тесты CORS-политики (S-8).

После фикса:
  - allow_origins=[]  (только same-origin; production уже same-origin через nginx);
  - allow_credentials=False (auth идёт через Authorization Bearer, cookies нет).

Проверяем, что чужой Origin не получает разрешающих CORS-заголовков, preflight
для чужого Origin отклоняется, а обычный same-origin запрос продолжает работать.
"""

import os
import sys
import types
from pathlib import Path
from unittest import mock

import pytest
from fastapi.testclient import TestClient

# ─────────────────────────────────────────────────────────────
# Подготовка импорта backend БЕЗ загрузки тяжёлой модели
# ─────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if "sentence_transformers" not in sys.modules:
    _stub = mock.MagicMock()
    _stub.encode.return_value = mock.MagicMock()
    _stub.encode.return_value.tolist.return_value = [[0.0] * 384]
    _st_module = types.ModuleType("sentence_transformers")
    _st_module.SentenceTransformer = mock.MagicMock(return_value=_stub)
    sys.modules["sentence_transformers"] = _st_module

os.environ.setdefault("SECRET_KEY", "test-secret-key")

import rag_api  # noqa: E402
from rag_api import app  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


EVIL_ORIGIN = "https://evil.example"


def test_cross_origin_request_gets_no_allow_origin_header(client):
    # Чужой Origin не должен получить разрешающий Access-Control-Allow-Origin.
    resp = client.get("/health", headers={"Origin": EVIL_ORIGIN})
    assert "access-control-allow-origin" not in resp.headers
    assert "access-control-allow-credentials" not in resp.headers


def test_preflight_cross_origin_is_rejected(client):
    # Preflight с чужим Origin отклоняется и не выдаёт разрешающих заголовков.
    resp = client.options(
        "/health",
        headers={
            "Origin": EVIL_ORIGIN,
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in resp.headers
    assert resp.status_code != 200


def test_same_origin_request_still_works(client):
    # Обычный запрос без Origin (same-origin) продолжает работать.
    resp = client.get("/health")
    assert resp.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
