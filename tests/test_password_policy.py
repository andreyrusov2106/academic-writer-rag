"""
Тесты серверной политики паролей (S-10).

Проверяют, что минимальная длина пароля проверяется НА СЕРВЕРЕ (Pydantic), а не
только в HTML-форме:
  - пароль короче 6 символов -> 422;
  - пустой пароль -> 422;
  - длина ровно 6 и 72 -> валидна, 73 -> 422;
  - невалидный пароль не приводит к созданию пользователя;
  - валидный пароль хэшируется bcrypt, plaintext не передаётся в create_user_in_db.
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


@pytest.fixture
def no_existing_user(monkeypatch):
    monkeypatch.setattr(rag_api, "get_user_by_email", lambda email: None)


@pytest.fixture
def capture_create(monkeypatch):
    calls = []

    def fake_create(email, hashed_password):
        calls.append((email, hashed_password))
        return 42

    monkeypatch.setattr(rag_api, "create_user_in_db", fake_create)
    return calls


def _register(client, password):
    return client.post("/auth/register", json={"email": "new@example.com", "password": password})


# ─────────────────────────────────────────────────────────────
# Граничные значения длины
# ─────────────────────────────────────────────────────────────
def test_password_shorter_than_6_is_rejected(client, no_existing_user, capture_create):
    resp = _register(client, "abcde")
    assert resp.status_code == 422
    assert capture_create == []


def test_empty_password_is_rejected(client, no_existing_user, capture_create):
    resp = _register(client, "")
    assert resp.status_code == 422
    assert capture_create == []


def test_password_length_6_is_valid(client, no_existing_user, capture_create):
    resp = _register(client, "123456")
    assert resp.status_code == 200
    assert len(capture_create) == 1


def test_password_length_72_is_valid(client, no_existing_user, capture_create):
    resp = _register(client, "a" * 72)
    assert resp.status_code == 200
    assert len(capture_create) == 1


def test_password_length_73_is_rejected(client, no_existing_user, capture_create):
    resp = _register(client, "a" * 73)
    assert resp.status_code == 422
    assert capture_create == []


# ─────────────────────────────────────────────────────────────
# Хэширование: plaintext не попадает в create_user_in_db
# ─────────────────────────────────────────────────────────────
def test_valid_password_is_bcrypt_hashed_before_insert(client, no_existing_user, capture_create):
    plain = "correct-horse-battery"
    resp = _register(client, plain)
    assert resp.status_code == 200

    email, hashed = capture_create[0]
    assert email == "new@example.com"
    assert hashed != plain
    assert hashed.startswith("$2b$")  # bcrypt-хэш
    assert rag_api.verify_password(plain, hashed) is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
