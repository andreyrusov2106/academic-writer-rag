"""
Тесты административного API управления доступом к статьям.

Проверяют:
  - все /admin/* эндпоинты требуют прав администратора (403 для не-админа);
  - источник is_admin — ТОЛЬКО БД (через get_current_user), не из тела запроса;
  - административные статьи — user_id IS NULL, сгруппированы по article_url;
  - global-флаг и правила доступа (по пользователям / по специальностям);
  - PUT заменяет правила (REPLACE), пустые списки -> global;
  - пользовательский документ скрывается за 404 (не изменяется и не удаляется);
  - DELETE удаляет чанки + правила + файл;
  - загрузка админа атомарна (чанки + правила в одной транзакции, user_id=None).
"""

import json
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
ADMIN_USER = {
    "id": 1,
    "email": "admin@example.com",
    "hashed_password": "x",
    "subscription_type": "free",
    "requests_used": 0,
    "requests_limit": 10,
    "is_admin": True,
    "specialty_code": None,
}

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
        self.rolled_back = False
        self.closed = False
        self.rowcount = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def _use_fake_conn(monkeypatch, respond=None):
    conn = FakeConn(respond)
    monkeypatch.setattr(rag_api, "get_db_connection", lambda: conn)
    return conn


# ─────────────────────────────────────────────────────────────
# Фикстуры клиента и пользователей
# ─────────────────────────────────────────────────────────────
@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def as_non_admin():
    app.dependency_overrides[rag_api.get_current_user] = lambda: dict(NON_ADMIN_USER)
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def as_admin():
    app.dependency_overrides[rag_api.get_current_user] = lambda: dict(ADMIN_USER)
    yield
    app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────────────
# 1. Авторизация: не-админ получает 403 на всех /admin/*
# ─────────────────────────────────────────────────────────────
def test_admin_users_requires_admin(client, as_non_admin):
    assert client.get("/admin/users").status_code == 403


def test_admin_articles_requires_admin(client, as_non_admin):
    assert client.get("/admin/articles").status_code == 403


def test_admin_upload_requires_admin(client, as_non_admin):
    resp = client.post(
        "/admin/upload",
        files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 403


def test_admin_set_access_requires_admin(client, as_non_admin):
    resp = client.put(
        "/admin/articles/abc.pdf/access",
        json={"user_ids": [1], "specialty_codes": []},
    )
    assert resp.status_code == 403


def test_admin_delete_requires_admin(client, as_non_admin):
    assert client.delete("/admin/articles/abc.pdf").status_code == 403


# ─────────────────────────────────────────────────────────────
# 2. GET /admin/users — только безопасные поля
# ─────────────────────────────────────────────────────────────
def test_admin_users_returns_only_safe_fields(client, as_admin, monkeypatch):
    def respond(sql, params):
        if "FROM users ORDER BY id" in sql:
            return [
                (1, "admin@example.com", True, None),
                (2, "user@example.com", False, "5.8.1"),
            ]
        return None

    _use_fake_conn(monkeypatch, respond)
    resp = client.get("/admin/users")

    assert resp.status_code == 200
    users = resp.json()["users"]
    assert users == [
        {"id": 1, "email": "admin@example.com", "is_admin": True, "specialty_code": None},
        {"id": 2, "email": "user@example.com", "is_admin": False, "specialty_code": "5.8.1"},
    ]
    # Никаких секретов (hashed_password, токены и т.п.)
    for u in users:
        assert set(u.keys()) == {"id", "email", "is_admin", "specialty_code"}


# ─────────────────────────────────────────────────────────────
# 2.1 PUT /admin/users/{user_id} — изменение is_admin / specialty_code
# ─────────────────────────────────────────────────────────────
def _update_respond(updated_row):
    """Хелпер respond-обработчика для PUT /admin/users/{user_id}."""
    def respond(sql, params):
        if "SELECT id, email, is_admin, specialty_code" in sql:
            return [updated_row]
        if "SELECT id FROM users" in sql:
            return [(updated_row[0],)]
        return None
    return respond


def test_admin_update_specialty_code(client, as_admin, monkeypatch):
    # Админ меняет только specialty_code пользователя.
    conn = _use_fake_conn(
        monkeypatch,
        _update_respond((2, "user@example.com", False, "5.8.2")),
    )
    resp = client.put("/admin/users/2", json={"specialty_code": "5.8.2"})

    assert resp.status_code == 200
    assert resp.json() == {
        "id": 2,
        "email": "user@example.com",
        "is_admin": False,
        "specialty_code": "5.8.2",
    }

    # Независимое обновление: только specialty_code, is_admin не трогается.
    update_sql, update_params = next((s, p) for s, p in conn.executed if "UPDATE users SET" in s)
    assert "specialty_code = %s" in update_sql
    assert "is_admin" not in update_sql
    assert update_params == ("5.8.2", 2)
    assert conn.committed


def test_admin_update_is_admin(client, as_admin, monkeypatch):
    # Админ меняет только is_admin пользователя.
    conn = _use_fake_conn(
        monkeypatch,
        _update_respond((2, "user@example.com", True, "5.8.1")),
    )
    resp = client.put("/admin/users/2", json={"is_admin": True})

    assert resp.status_code == 200
    assert resp.json() == {
        "id": 2,
        "email": "user@example.com",
        "is_admin": True,
        "specialty_code": "5.8.1",
    }

    update_sql, update_params = next((s, p) for s, p in conn.executed if "UPDATE users SET" in s)
    assert "is_admin = %s" in update_sql
    assert "specialty_code" not in update_sql
    assert update_params == (True, 2)


def test_admin_update_empty_specialty_code_clears(client, as_admin, monkeypatch):
    # Пустая строка specialty_code трактуется как null (снятие специальности).
    conn = _use_fake_conn(
        monkeypatch,
        _update_respond((2, "user@example.com", False, None)),
    )
    resp = client.put("/admin/users/2", json={"specialty_code": ""})

    assert resp.status_code == 200
    assert resp.json()["specialty_code"] is None
    update_sql, update_params = next((s, p) for s, p in conn.executed if "UPDATE users SET" in s)
    assert update_params == (None, 2)


def test_admin_update_requires_admin(client, as_non_admin):
    resp = client.put("/admin/users/2", json={"is_admin": True})
    assert resp.status_code == 403


def test_admin_update_nonexistent_user_404(client, as_admin, monkeypatch):
    def respond(sql, params):
        if "SELECT id FROM users" in sql:
            return []  # пользователя не существует
        return None

    _use_fake_conn(monkeypatch, respond)
    resp = client.put("/admin/users/999", json={"is_admin": True})
    assert resp.status_code == 404


def test_admin_cannot_remove_own_admin(client, as_admin):
    # Администратор не может снять is_admin с самого себя (id=1 — текущий админ).
    resp = client.put("/admin/users/1", json={"is_admin": False})
    assert resp.status_code == 400
    assert "себя" in resp.json()["detail"]


# ─────────────────────────────────────────────────────────────
# 3. GET /admin/articles — global и правила доступа
# ─────────────────────────────────────────────────────────────
def test_admin_articles_global_when_no_rules(client, as_admin, monkeypatch):
    def respond(sql, params):
        if "GROUP BY article_url, title" in sql:
            return [("url1.pdf", "Статья", 3)]
        if "FROM document_access_users" in sql:
            return []
        if "FROM document_access_specialties" in sql:
            return []
        return None

    conn = _use_fake_conn(monkeypatch, respond)
    resp = client.get("/admin/articles")

    assert resp.status_code == 200
    article = resp.json()["articles"][0]
    assert article["article_url"] == "url1.pdf"
    assert article["title"] == "Статья"
    assert article["chunks"] == 3
    assert article["allowed_user_ids"] == []
    assert article["allowed_specialty_codes"] == []
    assert article["global"] is True
    # запрос фильтрует только административные статьи (user_id IS NULL)
    articles_sql = conn.executed[0][0]
    assert "WHERE user_id IS NULL" in articles_sql


def test_admin_articles_restricted_by_users(client, as_admin, monkeypatch):
    def respond(sql, params):
        if "GROUP BY article_url, title" in sql:
            return [("url1.pdf", "Статья", 2)]
        if "FROM document_access_users" in sql:
            return [("url1.pdf", 10), ("url1.pdf", 20)]
        if "FROM document_access_specialties" in sql:
            return []
        return None

    _use_fake_conn(monkeypatch, respond)
    article = client.get("/admin/articles").json()["articles"][0]

    assert article["allowed_user_ids"] == [10, 20]
    assert article["allowed_specialty_codes"] == []
    assert article["global"] is False


def test_admin_articles_restricted_by_specialties(client, as_admin, monkeypatch):
    def respond(sql, params):
        if "GROUP BY article_url, title" in sql:
            return [("url1.pdf", "Статья", 1)]
        if "FROM document_access_users" in sql:
            return []
        if "FROM document_access_specialties" in sql:
            return [("url1.pdf", "5.8.1"), ("url1.pdf", "5.8.2")]
        return None

    _use_fake_conn(monkeypatch, respond)
    article = client.get("/admin/articles").json()["articles"][0]

    assert article["allowed_user_ids"] == []
    assert article["allowed_specialty_codes"] == ["5.8.1", "5.8.2"]
    assert article["global"] is False


# ─────────────────────────────────────────────────────────────
# 4. PUT /admin/articles/{article_url}/access — замена правил
# ─────────────────────────────────────────────────────────────
def test_admin_set_access_replaces_rules(client, as_admin, monkeypatch):
    def respond(sql, params):
        if "SELECT COUNT(*) FROM documents WHERE article_url" in sql:
            return [(1,)]
        return None

    conn = _use_fake_conn(monkeypatch, respond)
    resp = client.put(
        "/admin/articles/url1.pdf/access",
        json={"user_ids": [1, 2], "specialty_codes": ["5.8.2"]},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["user_ids"] == [1, 2]
    assert data["specialty_codes"] == ["5.8.2"]
    assert data["global"] is False

    sqls = [s for s, _ in conn.executed]
    # старые правила удаляются, новые вставляются
    assert any("DELETE FROM document_access_users" in s for s in sqls)
    assert any("DELETE FROM document_access_specialties" in s for s in sqls)
    assert any("INSERT INTO document_access_users" in s for s in sqls)
    assert any("INSERT INTO document_access_specialties" in s for s in sqls)
    assert conn.committed


def test_admin_set_access_empty_arrays_are_global(client, as_admin, monkeypatch):
    def respond(sql, params):
        if "SELECT COUNT(*) FROM documents WHERE article_url" in sql:
            return [(1,)]
        return None

    _use_fake_conn(monkeypatch, respond)
    resp = client.put(
        "/admin/articles/url1.pdf/access",
        json={"user_ids": [], "specialty_codes": []},
    )

    assert resp.status_code == 200
    assert resp.json()["global"] is True


def test_admin_set_access_user_owned_document_hidden(client, as_admin, monkeypatch):
    # Административная статья не найдена (документ принадлежит пользователю) -> 404
    _use_fake_conn(monkeypatch, lambda sql, params: [(0,)] if "SELECT COUNT(*) FROM documents" in sql else None)
    resp = client.put(
        "/admin/articles/userdoc.pdf/access",
        json={"user_ids": [1], "specialty_codes": []},
    )
    assert resp.status_code == 404


# ─────────────────────────────────────────────────────────────
# 5. DELETE /admin/articles/{article_url}
# ─────────────────────────────────────────────────────────────
def test_admin_delete_removes_chunks_rules_and_file(client, as_admin, monkeypatch, tmp_path):
    def respond(sql, params):
        if "SELECT COUNT(*) FROM documents WHERE article_url" in sql:
            return [(1,)]
        return None

    conn = _use_fake_conn(monkeypatch, respond)
    monkeypatch.setattr(rag_api, "UPLOAD_DIR", str(tmp_path))
    pdf = tmp_path / "url1.pdf"
    pdf.write_bytes(b"%PDF-1.4")

    resp = client.delete("/admin/articles/url1.pdf")

    assert resp.status_code == 200
    assert resp.json()["success"] is True

    sqls = [s for s, _ in conn.executed]
    assert any("DELETE FROM document_access_users" in s for s in sqls)
    assert any("DELETE FROM document_access_specialties" in s for s in sqls)
    assert any("DELETE FROM documents WHERE article_url" in s for s in sqls)
    assert conn.committed
    assert not pdf.exists()


def test_admin_delete_user_owned_document_hidden(client, as_admin, monkeypatch):
    conn = _use_fake_conn(monkeypatch, lambda sql, params: [(0,)] if "SELECT COUNT(*) FROM documents" in sql else None)
    resp = client.delete("/admin/articles/userdoc.pdf")

    assert resp.status_code == 404
    sqls = [s for s, _ in conn.executed]
    assert not any("DELETE FROM documents" in s for s in sqls)


# ─────────────────────────────────────────────────────────────
# 6. POST /admin/upload — создание статьи с правилами (user_id=None)
# ─────────────────────────────────────────────────────────────
def test_admin_upload_creates_article_with_rules(client, as_admin, monkeypatch, tmp_path):
    monkeypatch.setattr(rag_api, "UPLOAD_DIR", str(tmp_path))
    captured = {}

    def fake_build_chunks(file_path, display_title, storage_name, user_id=None):
        captured["build_user_id"] = user_id
        captured["storage_name"] = storage_name
        chunks = [
            rag_api.Chunk(
                article_url=storage_name,
                title=display_title,
                chunk_index=0,
                text="текст",
                embedding=[0.0] * 384,
                user_id=None,
            )
        ]
        return chunks, 100

    def fake_save(chunks, conn=None):
        captured["save_conn"] = conn
        captured["save_user_ids"] = [c.user_id for c in chunks]
        return len(chunks)

    monkeypatch.setattr(rag_api, "build_chunks", fake_build_chunks)
    monkeypatch.setattr(rag_api, "save_chunks_to_db", fake_save)
    conn = FakeConn(None)
    monkeypatch.setattr(rag_api, "get_db_connection", lambda: conn)

    resp = client.post(
        "/admin/upload",
        files={"file": ("original-name.pdf", b"%PDF-1.4 fake", "application/pdf")},
        data={"users": json.dumps([10, 20]), "specialties": json.dumps(["5.8.2"])},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["global"] is False
    # имя файла генерируется (uuid-хекс), а не берётся из оригинального имени
    assert data["article_url"] != "original-name.pdf"
    assert data["article_url"].endswith(".pdf")
    # чанки создаются с user_id=None
    assert captured["build_user_id"] is None
    assert captured["save_user_ids"] == [None]
    # правила доступа записываются в то же соединение (одна транзакция)
    assert captured["save_conn"] is conn
    sqls = [s for s, _ in conn.executed]
    assert any("INSERT INTO document_access_users" in s for s in sqls)
    assert any("INSERT INTO document_access_specialties" in s for s in sqls)
    assert conn.committed


def test_admin_upload_empty_rules_are_global(client, as_admin, monkeypatch, tmp_path):
    monkeypatch.setattr(rag_api, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(
        rag_api,
        "build_chunks",
        lambda *a, **k: (
            [rag_api.Chunk(article_url="x.pdf", title="T", chunk_index=0, text="t", embedding=[0.0] * 384, user_id=None)],
            10,
        ),
    )
    monkeypatch.setattr(rag_api, "save_chunks_to_db", lambda chunks, conn=None: len(chunks))
    conn = FakeConn(None)
    monkeypatch.setattr(rag_api, "get_db_connection", lambda: conn)

    resp = client.post(
        "/admin/upload",
        files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert resp.json()["global"] is True
    sqls = [s for s, _ in conn.executed]
    assert not any("INSERT INTO document_access" in s for s in sqls)


def test_admin_upload_atomic_on_db_error(client, as_admin, monkeypatch, tmp_path):
    monkeypatch.setattr(rag_api, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(
        rag_api,
        "build_chunks",
        lambda *a, **k: (
            [rag_api.Chunk(article_url="x.pdf", title="T", chunk_index=0, text="t", embedding=[0.0] * 384, user_id=None)],
            10,
        ),
    )

    def boom(chunks, conn=None):
        raise RuntimeError("db error")

    monkeypatch.setattr(rag_api, "save_chunks_to_db", boom)
    conn = FakeConn(None)
    monkeypatch.setattr(rag_api, "get_db_connection", lambda: conn)

    resp = client.post(
        "/admin/upload",
        files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")},
        data={"users": json.dumps([1])},
    )

    assert resp.status_code == 200
    assert resp.json()["success"] is False
    # транзакция откатывается, ничего не коммитится
    assert conn.rolled_back is True
    assert conn.committed is False
    # PDF на диске не остаётся
    assert list(tmp_path.glob("*.pdf")) == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
