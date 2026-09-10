"""
Тесты доступа к списку источников (GET /documents) и удалению (DELETE /documents).

Проверяют, что список источников использует ту же модель доступа, что и RAG-поиск
(match_documents, миграция 003_admin_article_access.sql):
  - собственные документы (documents.user_id = текущий пользователь);
  - административные статьи (documents.user_id IS NULL): глобальные, назначенные
    пользователю напрямую (document_access_users) или по специальности
    (document_access_specialties).

А также что обычный пользователь не может удалить чужую/административную статью
(DELETE /documents фильтрует по user_id владельца).
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
# Пользователи для тестов
# ─────────────────────────────────────────────────────────────
NON_ADMIN_USER = {
    "id": 2,
    "email": "user@example.com",
    "hashed_password": "x",
    "subscription_type": "free",
    "requests_used": 0,
    "requests_limit": 10,
    "is_admin": False,
    "specialty_code": "5.8.1",
}

NON_ADMIN_NO_SPECIALTY = {
    "id": 3,
    "email": "nospec@example.com",
    "hashed_password": "x",
    "subscription_type": "free",
    "requests_used": 0,
    "requests_limit": 10,
    "is_admin": False,
    "specialty_code": None,
}


# ─────────────────────────────────────────────────────────────
# Фейковое соединение с БД, управляемое обработчиком SQL
# ─────────────────────────────────────────────────────────────
class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self._rows = None

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, params))
        self._rows = self.conn.respond(sql, params) if self.conn.respond else None

    def fetchone(self):
        rows = self._rows or []
        return rows[0] if rows else None

    def fetchall(self):
        return self._rows or []

    @property
    def rowcount(self):
        return getattr(self.conn, "rowcount", 0)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConn:
    def __init__(self, respond=None):
        self.respond = respond
        self.executed = []
        self.committed = False
        self.closed = False
        self.rowcount = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


def _use_fake_conn(monkeypatch, respond=None):
    conn = FakeConn(respond)
    monkeypatch.setattr(rag_api, "get_db_connection", lambda: conn)
    return conn


def _list_sql_and_params(client, monkeypatch):
    conn = _use_fake_conn(monkeypatch, lambda sql, params: [("url1.pdf", "Статья", 3)])
    client.get("/documents")
    return conn.executed[0]


# ─────────────────────────────────────────────────────────────
# Фикстуры клиента и пользователей
# ─────────────────────────────────────────────────────────────
@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def as_user():
    app.dependency_overrides[rag_api.get_current_user] = lambda: dict(NON_ADMIN_USER)
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def as_user_no_specialty():
    app.dependency_overrides[rag_api.get_current_user] = lambda: dict(NON_ADMIN_NO_SPECIALTY)
    yield
    app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────────────
# 1. GET /documents — модель доступа, эквивалентная match_documents()
# ─────────────────────────────────────────────────────────────
def test_list_documents_sql_uses_access_model(client, as_user, monkeypatch):
    # Сценарии A–F: предикат доступа должен включать все ветки модели access rules.
    sql, _ = _list_sql_and_params(client, monkeypatch)
    sql_flat = " ".join(sql.split())  # нормализуем переносы строк/отступы

    # Собственные документы (A).
    assert "WHERE user_id = %s" in sql_flat
    # Административные статьи (B–F): user_id IS NULL.
    assert "user_id IS NULL" in sql_flat
    # Глобальный доступ — нет ни одного правила (B).
    assert "NOT EXISTS ( SELECT 1 FROM document_access_users" in sql_flat
    assert "NOT EXISTS ( SELECT 1 FROM document_access_specialties" in sql_flat
    # Прямой доступ пользователя (C).
    assert "au.user_id = %s" in sql_flat
    # Доступ по специальности (D).
    assert "asp.specialty_code = %s" in sql_flat
    assert "%s IS NOT NULL" in sql_flat

    # Список не должен зависеть от similarity-порога (никакого match_threshold).
    assert "similarity" not in sql_flat.lower()
    assert "match_threshold" not in sql_flat.lower()


def test_list_documents_params_order(client, as_user, monkeypatch):
    # Порядок параметров: (user_id, user_id, specialty_code, specialty_code).
    _, params = _list_sql_and_params(client, monkeypatch)
    assert params == (2, 2, "5.8.1", "5.8.1")


def test_list_documents_user_without_specialty(client, as_user_no_specialty, monkeypatch):
    # Пользователь без специальности -> specialty_code передаётся как None.
    _, params = _list_sql_and_params(client, monkeypatch)
    assert params == (3, 3, None, None)


def test_list_documents_returns_documents_shape(client, as_user, monkeypatch):
    conn = _use_fake_conn(
        monkeypatch,
        lambda sql, params: [
            ("url1.pdf", "Статья А", 3),
            ("url2.pdf", "Статья Б", 1),
        ],
    )
    resp = client.get("/documents")

    assert resp.status_code == 200
    assert resp.json() == {
        "documents": [
            {"article_url": "url1.pdf", "title": "Статья А", "chunks": 3},
            {"article_url": "url2.pdf", "title": "Статья Б", "chunks": 1},
        ]
    }


# ─────────────────────────────────────────────────────────────
# 2. DELETE /documents — владелец может удалять только свои документы (G)
# ─────────────────────────────────────────────────────────────
def test_delete_document_deletes_only_own_chunks(client, as_user, monkeypatch):
    conn = _use_fake_conn(monkeypatch)
    conn.rowcount = 5  # у пользователя есть собственные чанки с этим article_url

    resp = client.delete("/documents?article_url=url1.pdf")

    assert resp.status_code == 200
    assert resp.json() == {"success": True, "deleted_chunks": 5}

    sql, params = conn.executed[0]
    assert "DELETE FROM documents" in sql
    # ownership-фильтр: только собственные чанки по (user_id, article_url).
    assert "user_id = %s" in sql
    assert "article_url = %s" in sql
    assert params == (2, "url1.pdf")


def test_delete_document_admin_article_404_and_file_kept(client, as_user, monkeypatch, tmp_path):
    # Обычный пользователь пытается удалить административную/чужую статью
    # (нет его чанков -> rowcount=0 -> 404, файл не удаляется).
    conn = _use_fake_conn(monkeypatch)
    conn.rowcount = 0

    monkeypatch.setattr(rag_api, "UPLOAD_DIR", str(tmp_path))
    pdf = tmp_path / "url1.pdf"
    pdf.write_bytes(b"%PDF-1.4")

    resp = client.delete("/documents?article_url=url1.pdf")

    assert resp.status_code == 404
    # ownership-фильтр в SQL присутствует — удаление чужого невозможно.
    sql, params = conn.executed[0]
    assert "user_id = %s" in sql
    assert params == (2, "url1.pdf")
    # Физический PDF не тронут.
    assert pdf.exists()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
