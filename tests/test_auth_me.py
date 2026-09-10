"""
Тесты эндпоинта GET /auth/me.

Проверяют, что при загрузке страницы фронтенд может получить актуальные лимиты
пользователя с сервера (через существующий get_current_user), а не полагаться на
устаревшие данные из localStorage.
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


# ─────────────────────────────────────────────────────────────
# Пользователь с актуальными (не нулевыми) лимитами
# ─────────────────────────────────────────────────────────────
USER = {
    "id": 7,
    "email": "me@example.com",
    "hashed_password": "x",
    "subscription_type": "free",
    "requests_used": 11,
    "requests_limit": 100,
    "is_admin": False,
    "specialty_code": "5.8.1",
}


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def as_user():
    app.dependency_overrides[rag_api.get_current_user] = lambda: dict(USER)
    yield
    app.dependency_overrides.clear()


def test_auth_me_requires_auth(client):
    resp = client.get("/auth/me")
    assert resp.status_code in (401, 403)


def test_auth_me_returns_current_limits(client, as_user):
    resp = client.get("/auth/me")
    assert resp.status_code == 200
    assert resp.json() == {
        "user_id": 7,
        "email": "me@example.com",
        "subscription_type": "free",
        "requests_used": 11,
        "requests_limit": 100,
    }


def test_auth_me_reflects_server_state_not_zero(client, as_user):
    # Защита от регресса: requests_used берётся из БД (11), а не сбрасывается в 0.
    data = client.get("/auth/me").json()
    assert data["requests_used"] == 11
    assert data["requests_limit"] == 100


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
