"""
Статические тесты очистки сессии (U-2: cross-user leakage через localStorage).

Проверяют, что clearSession() удаляет user-scoped ключи и сбрасывает in-memory
состояние, а logout/401-ветки не оставляют отдельной неполной очистки token/user.
"""

from pathlib import Path

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
CHAT_JS = FRONTEND_DIR / "js" / "chat.js"
ADMIN_JS = FRONTEND_DIR / "js" / "admin.js"

# Ключи, привязанные к конкретному пользователю: должны удаляться в clearSession.
USER_SCOPED_KEYS = [
    "academic_writer_token",
    "academic_writer_user",
    "academic_writer_chat_history",
    "academic_writer_content",
    "academic_writer_terms",
]

# Глобальные UI-предпочтения: НЕ должны удаляться в clearSession.
GLOBAL_UI_KEYS = [
    "academic_writer_theme",
    "academic_writer_lang",
    "academic_writer_gost",
    "active_gost",
]


def _chat_js() -> str:
    return CHAT_JS.read_text(encoding="utf-8")


def _admin_js() -> str:
    return ADMIN_JS.read_text(encoding="utf-8")


def _extract_function(js: str, name: str) -> str:
    """Возвращает тело функции name (до следующей top-level function)."""
    start = js.index(f"function {name}(")
    rest = js[start:]
    nxt = rest.find("\nfunction ", 1)
    return rest[:nxt] if nxt != -1 else rest


def _extract_clear_session() -> str:
    """Возвращает тело функции clearSession() (до следующей top-level function)."""
    return _extract_function(_chat_js(), "clearSession")


def test_clear_session_removes_user_scoped_keys():
    body = _extract_clear_session()
    for key in USER_SCOPED_KEYS:
        assert f"localStorage.removeItem('{key}')" in body, \
            f"clearSession не удаляет {key}"


def test_clear_session_resets_in_memory_state():
    body = _extract_clear_session()
    assert "chatHistory = []" in body
    assert "allSources = []" in body
    assert "terms = []" in body


def test_no_partial_token_user_clear_outside_clear_session():
    # Единственная неполная очистка token/user не должна оставаться в 401-ветках.
    js = _chat_js()
    body = _extract_clear_session()
    remaining = js.replace(body, "")
    assert "localStorage.removeItem('academic_writer_token')" not in remaining, \
        "осталось ручное removeItem(token) вне clearSession"
    assert "localStorage.removeItem('academic_writer_user')" not in remaining, \
        "осталось ручное removeItem(user) вне clearSession"


def test_global_ui_keys_not_cleared_by_clear_session():
    body = _extract_clear_session()
    for key in GLOBAL_UI_KEYS:
        assert f"localStorage.removeItem('{key}')" not in body, \
            f"clearSession не должен удалять глобальный ключ {key}"


def test_admin_clear_token_removes_user_scoped_keys():
    body = _extract_function(_admin_js(), "clearToken")
    # token/user удаляются через константы TOKEN_KEY/USER_KEY, объявленные в admin.js.
    for const, key in (("TOKEN_KEY", "academic_writer_token"),
                       ("USER_KEY", "academic_writer_user")):
        assert f"localStorage.removeItem({const})" in body, \
            f"clearToken не удаляет {key} (через {const})"
    for key in ("academic_writer_chat_history",
                "academic_writer_content",
                "academic_writer_terms"):
        assert f"localStorage.removeItem('{key}')" in body, \
            f"clearToken не удаляет {key}"


def test_load_documents_handles_401_with_clear_session():
    body = _extract_function(_chat_js(), "loadDocuments")
    assert "if (res.status === 401) {" in body, \
        "loadDocuments не имеет отдельной ветки 401"
    idx = body.index("if (res.status === 401) {")
    assert "clearSession();" in body[idx:], \
        "loadDocuments не вызывает clearSession() в ветке 401"


def test_delete_document_handles_401_with_clear_session():
    body = _extract_function(_chat_js(), "deleteDocument")
    assert "if (res.status === 401) {" in body, \
        "deleteDocument не имеет отдельной ветки 401"
    idx = body.index("if (res.status === 401) {")
    assert "clearSession();" in body[idx:], \
        "deleteDocument не вызывает clearSession() в ветке 401"


def test_clear_session_resets_quill_editor():
    body = _extract_clear_session()
    assert "typeof quill !== 'undefined'" in body, \
        "clearSession не содержит защитного гварда для Quill"
    assert "quill.setContents([])" in body, \
        "clearSession не сбрасывает содержимое Quill-редактора"


def test_clear_session_resets_usage_indicator():
    body = _extract_clear_session()
    assert "getElementById('usage-indicator')" in body, \
        "clearSession не сбрасывает #usage-indicator"
    assert "indicator.textContent = '0 / 100 запросов (free)'" in body, \
        "clearSession не задаёт дефолтное значение usage-indicator"


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
