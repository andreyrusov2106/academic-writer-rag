"""
Регрессионные тесты S-11: сырые исключения и тела ответов внешних API
(DeepSeek/OpenAlex) не должны попадать в ответ клиенту.

Проверяют, что:
  - клиент получает только generic-сообщения (INTERNAL_ERROR_MSG / EXTERNAL_API_ERROR_MSG);
  - str(e)/repr(e)/resp.text/стектрейс не просачиваются в JSON-ответы;
  - ошибочные результаты /smart-action начинаются с U+FE0F (фронтенд распознаёт
    их как ошибку и показывает уведомление вместо вставки в документ);
  - неожиданные ошибки логируются на сервере через log.exception(...).
"""

import logging
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

_SRC = (BACKEND_DIR / "rag_api.py").read_text(encoding="utf-8")

USER = {
    "id": 2,
    "email": "user@example.com",
    "hashed_password": "x",
    "subscription_type": "free",
    "requests_used": 0,
    "requests_limit": 10,
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


# ═════════════════════════════════════════════════════════════
# СТАТИЧЕСКИЕ ПРОВЕРКИ ИСХОДНИКА (нет утечек на уровне кода)
# ═════════════════════════════════════════════════════════════
def test_no_raw_exception_in_http_exception_detail():
    # HTTPException больше нигде не формирует detail из str(e)/repr(e).
    assert "detail=str(e)" not in _SRC
    assert "detail=repr(e)" not in _SRC


def test_no_resp_text_or_str_e_leaked_to_sse_client():
    # /ask-stream больше не отдаёт клиенту тело DeepSeek и строку исключения.
    assert "Ошибка API: {resp.text}" not in _SRC
    assert "content': str(e)" not in _SRC


def test_no_raw_error_in_smart_action_result():
    # /smart-action больше не возвращает f"... Ошибка: {e}".
    assert 'Ошибка: {e}"' not in _SRC


def test_generic_messages_defined():
    assert 'INTERNAL_ERROR_MSG = "Внутренняя ошибка сервера. Попробуйте ещё раз позже."' in _SRC
    assert 'EXTERNAL_API_ERROR_MSG = "Сервис анализа временно недоступен. Попробуйте ещё раз."' in _SRC


def test_log_exception_used_for_unexpected_errors():
    # Неожиданные ошибки логируются с трейсбеком на сервере.
    assert "log.exception(" in _SRC


# ═════════════════════════════════════════════════════════════
# ПОВЕДЕНЧЕСКИЕ ПРОВЕРКИ
# ═════════════════════════════════════════════════════════════
def test_health_error_returns_generic_not_raw(monkeypatch):
    def boom():
        raise RuntimeError("SECRET_DB_PASSWORD=super-secret")

    monkeypatch.setattr(rag_api, "get_db_connection", boom)
    resp = TestClient(app).get("/health")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "unhealthy"
    assert data["error"] == rag_api.INTERNAL_ERROR_MSG
    assert "super-secret" not in resp.text
    assert "SECRET_DB_PASSWORD" not in resp.text


def test_health_error_is_logged(monkeypatch, caplog):
    def boom():
        raise RuntimeError("SECRET_DB_PASSWORD=super-secret")

    monkeypatch.setattr(rag_api, "get_db_connection", boom)
    with caplog.at_level(logging.ERROR):
        TestClient(app).get("/health")

    assert any("Ошибка проверки состояния БД" in r.message for r in caplog.records)


def test_documents_get_db_error_generic_detail(client, as_user, monkeypatch):
    def boom():
        raise RuntimeError("SECRET_INTERNAL_QUERY_FAILED")

    monkeypatch.setattr(rag_api, "get_db_connection", boom)
    resp = client.get("/documents")

    assert resp.status_code == 500
    assert resp.json()["detail"] == rag_api.INTERNAL_ERROR_MSG
    assert "SECRET_INTERNAL_QUERY_FAILED" not in resp.text


def test_smart_action_llm_error_generic_with_fe0f_prefix(client, as_user, monkeypatch):
    monkeypatch.setattr(rag_api, "try_reserve_request", lambda user_id: 1)
    monkeypatch.setattr(rag_api, "refund_request", lambda user_id: None)
    monkeypatch.setattr(rag_api, "DEEPSEEK_API_KEY", "test-key")

    class FakeResp:
        ok = False
        status_code = 500
        text = '{"error": "SECRET_UPSTREAM_BODY_LEAK"}'

    monkeypatch.setattr(rag_api.requests, "post", lambda *a, **k: FakeResp())

    resp = client.post("/smart-action", json={"text": "текст", "action": "fix_style"})

    assert resp.status_code == 200
    data = resp.json()
    # Фронтенд (smart-editor.js) распознаёт результат, начинающийся с U+FE0F, как ошибку.
    assert data["result"].startswith("️")
    assert data["result"].endswith(rag_api.EXTERNAL_API_ERROR_MSG)
    assert "SECRET_UPSTREAM_BODY_LEAK" not in data["result"]


def test_smart_action_exception_generic_with_fe0f_prefix(client, as_user, monkeypatch):
    monkeypatch.setattr(rag_api, "try_reserve_request", lambda user_id: 1)
    monkeypatch.setattr(rag_api, "refund_request", lambda user_id: None)
    monkeypatch.setattr(rag_api, "DEEPSEEK_API_KEY", "test-key")

    def boom(*a, **k):
        raise RuntimeError("SECRET_INTERNAL_TRACEBACK_DETAIL")

    monkeypatch.setattr(rag_api.requests, "post", boom)

    resp = client.post("/smart-action", json={"text": "текст", "action": "fix_style"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["result"].startswith("️")
    assert data["result"].endswith(rag_api.EXTERNAL_API_ERROR_MSG)
    assert "SECRET_INTERNAL_TRACEBACK_DETAIL" not in data["result"]


def test_ask_llm_non_ok_returns_generic(monkeypatch):
    monkeypatch.setattr(rag_api, "DEEPSEEK_API_KEY", "test-key")

    class FakeResp:
        ok = False
        status_code = 429
        text = "SECRET_BODY"

    monkeypatch.setattr(rag_api.requests, "post", lambda *a, **k: FakeResp())
    result = rag_api.ask_llm("q", "ctx", [])

    assert result["answer_ru"] == rag_api.EXTERNAL_API_ERROR_MSG
    assert "SECRET_BODY" not in result["answer_ru"]


def test_ask_llm_exception_returns_generic(monkeypatch):
    monkeypatch.setattr(rag_api, "DEEPSEEK_API_KEY", "test-key")

    def boom(*a, **k):
        raise RuntimeError("SECRET_INTERNAL_DETAIL")

    monkeypatch.setattr(rag_api.requests, "post", boom)
    result = rag_api.ask_llm("q", "ctx", [])

    assert result["answer_ru"] == rag_api.EXTERNAL_API_ERROR_MSG
    assert "SECRET_INTERNAL_DETAIL" not in result["answer_ru"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
