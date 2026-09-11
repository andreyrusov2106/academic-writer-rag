"""
Статические тесты обработки malformed JSON из localStorage (U-5).

Проверяют, что три JSON.parse из localStorage (user / terms / chat_history)
обёрнуты в try/catch и при ошибке дают безопасный fallback, не ломая
инициализацию chat.js и страницы.
"""

from pathlib import Path

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
CHAT_JS = FRONTEND_DIR / "js" / "chat.js"


def _chat_js() -> str:
    return CHAT_JS.read_text(encoding="utf-8")


def _extract_function(js: str, name: str) -> str:
    """Возвращает тело функции name (до следующей top-level function)."""
    start = js.index(f"function {name}(")
    rest = js[start:]
    nxt = rest.find("\nfunction ", 1)
    return rest[:nxt] if nxt != -1 else rest


def test_current_user_has_null_fallback():
    js = _chat_js()
    assert "let currentUser = null;" in js, \
        "currentUser не инициализируется null до JSON.parse"
    assert "try { currentUser = JSON.parse(" in js, \
        "JSON.parse(academic_writer_user) не обёрнут в try"
    assert "catch (e) { currentUser = null; }" in js, \
        "currentUser не имеет fallback null в catch"


def test_terms_have_empty_array_fallback():
    js = _chat_js()
    assert "let terms = [];" in js, \
        "terms не инициализируется [] до JSON.parse"
    assert "try { terms = JSON.parse(" in js, \
        "JSON.parse(academic_writer_terms) не обёрнут в try"
    assert "catch (e) { terms = []; }" in js, \
        "terms не имеет fallback [] в catch"


def test_chat_history_has_try_catch_and_fallback():
    body = _extract_function(_chat_js(), "initChat")
    assert "localStorage.getItem('academic_writer_chat_history')" in body, \
        "initChat не читает academic_writer_chat_history"
    assert "chatHistory = JSON.parse(savedChat);" in body, \
        "initChat не парсит savedChat в chatHistory"
    assert "try {" in body, \
        "JSON.parse(chat_history) не обёрнут в try"
    assert "chatHistory = [];" in body, \
        "chat_history не имеет fallback chatHistory = []"


def test_all_three_localstorage_parses_are_guarded():
    js = _chat_js()
    # user / terms — top-level: перед JSON.parse(localStorage.getItem(...)) стоит try {
    for key in ("academic_writer_user", "academic_writer_terms"):
        expr = f"JSON.parse(localStorage.getItem('{key}')"
        idx = js.index(expr)
        assert "try {" in js[max(0, idx - 40):idx], \
            f"{key}: перед JSON.parse нет try"

    # chat_history — внутри initChat: перед JSON.parse(savedChat) стоит try {
    body = _extract_function(js, "initChat")
    idx = body.index("JSON.parse(savedChat)")
    assert "try {" in body[max(0, idx - 40):idx], \
        "chat_history: перед JSON.parse(savedChat) нет try"


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
