"""
Статические тесты UX-фикса зависшего /api/ask-stream (sendChat).

Проверяют, что sendChat() прерывает запрос по таймауту (AbortController + 120 с),
показывает дружелюбные ошибки вместо сырых (error.message / «Failed to fetch»),
а индикатор «Думаю...» не стирается сразу после HTTP-ответа — только перед первым
answer-чанком.
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


def _send_chat() -> str:
    return _extract_function(_chat_js(), "sendChat")


def test_send_chat_uses_abort_controller_and_timeout():
    body = _send_chat()
    assert "new AbortController()" in body, "нет AbortController"
    assert "setTimeout(() => controller.abort(), 120000)" in body, "нет таймаута 120 с"
    assert "signal: controller.signal" in body, "fetch не передаёт signal"
    assert "clearTimeout(timeoutId)" in body, "таймаут не сбрасывается в finally"


def test_send_chat_tracks_completion_flag():
    body = _send_chat()
    assert "let completed = false;" in body, "нет флага completed = false"
    assert "completed = true;" in body, "done/error не устанавливает completed = true"
    assert "if (!completed) {" in body, "нет проверки EOF без done"


def test_send_chat_uses_friendly_errors_not_raw_message():
    body = _send_chat()
    assert "renderAssistantError(answerDiv, error.message)" not in body, \
        "остался сырой error.message"
    assert "Не удалось получить ответ. Попробуйте ещё раз." in body, \
        "нет дружелюбной ошибки таймаута/сети"
    assert "Соединение с ассистентом прервано. Попробуйте ещё раз." in body, \
        "нет ошибки обрыва потока без done"


def test_send_chat_does_not_clear_thinking_before_first_answer():
    body = _send_chat()
    assert "let buffer = ''; answerDiv.innerHTML = '';" not in body, \
        "«Думаю...» стирается сразу после HTTP-ответа"
    assert "if (!fullAnswer) answerDiv.innerHTML = '';" in body, \
        "«Думаю...» не очищается перед первым answer-чанком"


def test_send_chat_finally_resets_state():
    body = _send_chat()
    assert "sendBtn.disabled = false; isStreaming = false;" in body, \
        "finally не разблокирует кнопку и не сбрасывает isStreaming"


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
