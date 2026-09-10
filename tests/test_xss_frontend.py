"""
Статические проверки устранения DOM XSS (S-1..S-7).

Проверяют, что фронтенд не строит динамический HTML строковой конкатенацией
в местах, где данные пользователя / LLM / сторонних API могут содержать
HTML/JS, и не использует inline-обработчики для динамических данных.

Это регрессионные проверки на уровне исходников: они фиксируют, что
опасные паттерны (inline-onclick с данными, innerHTML с сырым ответом и т.п.)
больше не встречаются, а вместо них используются DOM API / textContent /
экранирование в правильном контексте.
"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
JS_DIR = BASE_DIR / "frontend" / "js"


def _read(name):
    return (JS_DIR / name).read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# S-1: inline-onclick для цитирования и удаления документа
# ─────────────────────────────────────────────────────────────
def test_chat_no_inline_onclick_for_citation():
    js = _read("chat.js")
    assert 'onclick="insertCitation' not in js


def test_chat_no_inline_onclick_for_delete_document():
    js = _read("chat.js")
    assert 'onclick="deleteDocument' not in js


# ─────────────────────────────────────────────────────────────
# S-2 / S-3: ответ LLM и ошибки не вставляются через innerHTML
# ─────────────────────────────────────────────────────────────
def test_chat_answer_not_inserted_via_innerhtml():
    js = _read("chat.js")
    assert 'innerHTML = fullAnswer' not in js
    assert 'fullAnswer.replace' not in js
    # Безопасные альтернативы присутствуют.
    assert 'buildAnswerSources' in js
    assert 'renderAssistantAnswer' in js


def test_chat_error_not_inserted_via_innerhtml():
    js = _read("chat.js")
    assert 'innerHTML = `<span style="color: red;">Ошибка: ${data.content}`' not in js
    assert 'innerHTML = `<span style="color: red;">Ошибка: ${error.message}`' not in js
    assert 'renderAssistantError' in js


# ─────────────────────────────────────────────────────────────
# S-4: OpenAlex — безопасный URL и textContent вместо innerHTML
# ─────────────────────────────────────────────────────────────
def test_search_uses_safe_url_helper():
    js = _read("search.js")
    assert 'safeExternalUrl' in js
    # Результаты больше не собираются строкой и не вставляются как HTML.
    assert 'resultsHtml' not in js


def test_search_error_not_inserted_via_innerhtml():
    js = _read("search.js")
    assert 'innerHTML = `<span style="color: red;">Ошибка поиска' not in js


# ─────────────────────────────────────────────────────────────
# S-5: Smart Editor — анализ и источники как текст
# ─────────────────────────────────────────────────────────────
def test_smart_editor_analysis_rendered_as_text():
    js = _read("smart-editor.js")
    assert 'analysis.replace' not in js
    assert '.textContent = analysis' in js


def test_smart_editor_sources_rendered_as_text():
    js = _read("smart-editor.js")
    assert 'content.innerHTML = html' not in js


# ─────────────────────────────────────────────────────────────
# S-6: editor.js — экранирование перед dangerouslyPasteHTML
# ─────────────────────────────────────────────────────────────
def test_editor_toc_escapes_heading():
    js = _read("editor.js")
    assert 'escapeHtml(text)' in js


def test_editor_bibliography_escapes_title_and_url():
    js = _read("editor.js")
    assert 'escapeHtml(source.title' in js


# ─────────────────────────────────────────────────────────────
# S-7: app.js — восстановление контента не через innerHTML
# ─────────────────────────────────────────────────────────────
def test_app_restores_via_clipboard_convert():
    js = _read("app.js")
    assert 'quill.root.innerHTML = savedContent' not in js
    assert 'quill.clipboard.convert' in js


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
