"""
Тесты серверного учёта лимитов запросов.

Проверяют, что лимит Free/Pro определяется и контролируется ТОЛЬКО на сервере:
  - резервирование слота атомарно (один UPDATE с условием requests_used < requests_limit);
  - пользователь после исчерпания лимита получает 403;
  - поддельные данные фронтенда (requests_used/requests_limit) игнорируются;
  - конкурентные запросы у границы лимита не обходят лимит;
  - слот возвращается, если AI-запрос не был завершён успешно.
"""

import os
import sys
import threading
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

# Без SECRET_KEY импорт rag_api падает с RuntimeError (fail-fast при старте).
# Для остальных тестов задаём тестовый ключ ДО импорта модуля.
os.environ.setdefault("SECRET_KEY", "test-secret-key")

import rag_api  # noqa: E402
from rag_api import app  # noqa: E402


# ─────────────────────────────────────────────────────────────
# Пользователи для тестов
# ─────────────────────────────────────────────────────────────
FREE_USER = {
    "id": 1,
    "email": "free@example.com",
    "hashed_password": "x",
    "subscription_type": "free",
    "requests_used": 5,
    "requests_limit": 10,
}

LIMITED_USER = {
    "id": 2,
    "email": "limited@example.com",
    "hashed_password": "x",
    "subscription_type": "free",
    "requests_used": 10,
    "requests_limit": 10,
}


# ─────────────────────────────────────────────────────────────
# Фейковое атомарное хранилище, имитирующее поведение PostgreSQL
# ─────────────────────────────────────────────────────────────
class FakeAtomicDB:
    """Имитирует атомарный UPDATE ... WHERE requests_used < requests_limit.

    Проверка условия и инкремент происходят под блокировкой — так же, как в
    PostgreSQL, где проверка и увеличение выполняются в одной строке (атомарно).
    """

    def __init__(self, used=0, limit=10):
        self.used = used
        self.limit = limit
        self._lock = threading.Lock()

    def reserve(self):
        with self._lock:
            if self.used < self.limit:
                self.used += 1
                return self.used
            return None

    def refund(self):
        with self._lock:
            if self.used > 0:
                self.used -= 1


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self._row = None

    def execute(self, sql, params=None):
        self.conn.last_sql = sql
        self.conn.last_params = params
        self._row = None
        if "requests_used = requests_used + 1" in sql:
            self._row = self.conn.db.reserve()
        elif "GREATEST(requests_used - 1, 0)" in sql:
            self.conn.db.refund()

    def fetchone(self):
        return (self._row,) if self._row is not None else None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeConn:
    def __init__(self, db):
        self.db = db
        self.last_sql = None
        self.last_params = None
        self.committed = False

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.committed = True

    def rollback(self):
        pass

    def close(self):
        pass


def _use_fake_db(monkeypatch, used=0, limit=10):
    db = FakeAtomicDB(used=used, limit=limit)
    holder = {}

    def fake_conn():
        conn = FakeConn(db)
        holder["conn"] = conn
        return conn

    monkeypatch.setattr(rag_api, "get_db_connection", fake_conn)
    return db, holder


# ─────────────────────────────────────────────────────────────
# Тесты атомарности резервирования/возврата слота
# ─────────────────────────────────────────────────────────────
def test_reserve_request_uses_single_atomic_conditional_update(monkeypatch):
    """Резервирование должно быть одним UPDATE с условием лимита (без SELECT-затем-UPDATE)."""
    db, holder = _use_fake_db(monkeypatch, used=0, limit=10)
    result = rag_api.try_reserve_request(1)

    assert result == 1
    sql = holder["conn"].last_sql
    assert "requests_used = requests_used + 1" in sql
    assert "requests_used < requests_limit" in sql
    assert holder["conn"].committed


def test_reserve_request_returns_none_when_limit_reached(monkeypatch):
    db, _ = _use_fake_db(monkeypatch, used=10, limit=10)
    assert rag_api.try_reserve_request(1) is None
    # счётчик не должен уйти за лимит
    assert db.used == 10


def test_refund_request_never_goes_below_zero(monkeypatch):
    db, holder = _use_fake_db(monkeypatch, used=0, limit=10)
    rag_api.refund_request(1)

    assert db.used == 0
    assert "GREATEST(requests_used - 1, 0)" in holder["conn"].last_sql


def test_concurrent_requests_do_not_exceed_limit(monkeypatch):
    """Конкурентные запросы у границы лимита не должны превысить лимит."""
    LIMIT = 10
    N_THREADS = 50
    db, _ = _use_fake_db(monkeypatch, used=0, limit=LIMIT)

    results = []

    def worker():
        results.append(rag_api.try_reserve_request(1))

    threads = [threading.Thread(target=worker) for _ in range(N_THREADS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    reserved = [r for r in results if r is not None]
    rejected = [r for r in results if r is None]

    assert len(reserved) == LIMIT
    assert len(rejected) == N_THREADS - LIMIT
    assert db.used == LIMIT


def test_concurrent_refunds_return_reserved_slots(monkeypatch):
    """Параллельные refund возвращают каждый зарезервированный слот ровно один раз."""
    RESERVED = 20
    db, _ = _use_fake_db(monkeypatch, used=RESERVED, limit=RESERVED)

    threads = [threading.Thread(target=rag_api.refund_request, args=(1,)) for _ in range(RESERVED)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Если бы декремент терялся из-за гонки (read-modify-write), счётчик остался бы > 0.
    assert db.used == 0


def test_concurrent_refunds_never_go_below_zero(monkeypatch):
    """Параллельные refund при избытке не уводят счётчик ниже нуля."""
    db, _ = _use_fake_db(monkeypatch, used=3, limit=10)

    threads = [threading.Thread(target=rag_api.refund_request, args=(1,)) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert db.used == 0


# ─────────────────────────────────────────────────────────────
# Тесты эндпоинтов
# ─────────────────────────────────────────────────────────────
@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def as_limited_user():
    app.dependency_overrides[rag_api.get_current_user] = lambda: dict(LIMITED_USER)
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def as_free_user():
    app.dependency_overrides[rag_api.get_current_user] = lambda: dict(FREE_USER)
    yield
    app.dependency_overrides.clear()


def _stub_reservation(monkeypatch, reserve_result, refund_log):
    monkeypatch.setattr(rag_api, "try_reserve_request", lambda uid: reserve_result)
    monkeypatch.setattr(rag_api, "refund_request", lambda uid: refund_log.append(uid))


def test_ask_requires_auth(client):
    resp = client.post("/ask", json={"question": "тест"})
    assert resp.status_code in (401, 403)


def test_ask_stream_requires_auth(client):
    resp = client.post("/ask-stream", json={"question": "тест"})
    assert resp.status_code in (401, 403)


def test_smart_action_requires_auth(client):
    resp = client.post("/smart-action", json={"text": "текст", "action": "fix_style"})
    assert resp.status_code in (401, 403)


def test_ask_returns_403_when_limit_reached(client, as_limited_user, monkeypatch):
    _stub_reservation(monkeypatch, reserve_result=None, refund_log=[])
    resp = client.post("/ask", json={"question": "тест"})
    assert resp.status_code == 403


def test_ask_stream_returns_403_when_limit_reached(client, as_limited_user, monkeypatch):
    _stub_reservation(monkeypatch, reserve_result=None, refund_log=[])
    resp = client.post("/ask-stream", json={"question": "тест"})
    assert resp.status_code == 403


def test_smart_action_returns_403_when_limit_reached(client, as_limited_user, monkeypatch):
    _stub_reservation(monkeypatch, reserve_result=None, refund_log=[])
    resp = client.post("/smart-action", json={"text": "текст", "action": "fix_style"})
    assert resp.status_code == 403


def test_frontend_data_changes_do_not_affect_server_limit(client, as_limited_user, monkeypatch):
    """Даже поддельные requests_used/requests_limit в теле запроса не влияют на серверный лимит."""
    _stub_reservation(monkeypatch, reserve_result=None, refund_log=[])
    resp = client.post(
        "/ask-stream",
        json={
            "question": "тест",
            "requests_used": 0,
            "requests_limit": 999999,
            "subscription_type": "pro",
        },
    )
    assert resp.status_code == 403


def test_user_within_limit_can_request(client, as_free_user, monkeypatch):
    """Пользователь в пределах лимита получает ответ, а не 403."""
    refund_log = []
    _stub_reservation(monkeypatch, reserve_result=FREE_USER["requests_used"] + 1, refund_log=refund_log)
    monkeypatch.setattr(rag_api, "get_embedding", lambda text: [0.0] * 384)
    monkeypatch.setattr(rag_api, "search_documents", lambda *a, **k: [])
    monkeypatch.setattr(rag_api, "search_openalex", lambda *a, **k: [])

    resp = client.post("/ask-stream", json={"question": "тест"})

    assert resp.status_code == 200
    assert '"done"' in resp.text
    # Ничего не найдено => AI-запрос не выполнен => слот возвращён
    assert refund_log == [FREE_USER["id"]]


def test_missing_secret_key_fails_fast():
    """Без SECRET_KEY приложение должно завершаться с понятной ошибкой при старте.

    Проверяется в изолированном подпроцессе: в нём SECRET_KEY убран из окружения,
    а .env отсутствует, поэтому импорт rag_api обязан упасть с RuntimeError.
    """
    import subprocess

    code = (
        "import sys, types\n"
        "from unittest import mock\n"
        f"sys.path.insert(0, {str(BACKEND_DIR)!r})\n"
        "_st = types.ModuleType('sentence_transformers')\n"
        "_st.SentenceTransformer = mock.MagicMock()\n"
        "sys.modules['sentence_transformers'] = _st\n"
        "import rag_api\n"
    )
    env = {k: v for k, v in os.environ.items() if k != "SECRET_KEY"}
    proc = subprocess.run(
        [sys.executable, "-c", code],
        env=env,
        capture_output=True,
        text=True,
    )
    assert proc.returncode != 0, proc.stdout
    assert "SECRET_KEY" in proc.stderr
