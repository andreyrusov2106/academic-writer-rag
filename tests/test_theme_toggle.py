"""
Статические тесты переключателя темы (U-1).

Фиксируют минимальный инвариант после фикса:
  - ровно одно определение toggleTheme в активном frontend/js/;
  - ровно один click-handler для #theme-toggle-btn;
  - toggleTheme и loadTheme используют один ключ academic_writer_theme;
  - мёртвый селектор #theme-toggle-btn-left больше не используется.

Это статические проверки исходников JS/HTML (без браузера), потому что баг
вызван дублированием глобальной функции, дублированием обработчика клика и
рассинхроном ключей localStorage — всё это видно на уровне исходников.
"""

import re
from pathlib import Path

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
JS_DIR = FRONTEND_DIR / "js"
HTML_FILE = FRONTEND_DIR / "academic-writer.html"


def _js() -> dict:
    """Возвращает {имя_файла: текст} для всех *.js в frontend/js/."""
    return {p.name: p.read_text(encoding="utf-8") for p in sorted(JS_DIR.glob("*.js"))}


JS = _js()


# ─────────────────────────────────────────────────────────────
# 1. Ровно одно определение toggleTheme
# ─────────────────────────────────────────────────────────────
def test_exactly_one_toggle_theme_definition():
    definitions = [
        name
        for name, text in JS.items()
        if re.search(r"\bfunction\s+toggleTheme\s*\(", text)
    ]
    assert len(definitions) == 1, f"Определений toggleTheme: {definitions}"
    assert definitions == ["editor.js"], f"toggleTheme должен жить в editor.js, найден в {definitions}"


# ─────────────────────────────────────────────────────────────
# 2. Ровно один click-handler для #theme-toggle-btn
# ─────────────────────────────────────────────────────────────
def test_exactly_one_click_handler_for_theme_toggle_btn():
    handlers = [
        name
        for name, text in JS.items()
        if "addEventListener('click', toggleTheme)" in text
    ]
    assert len(handlers) == 1, f"click-handler для toggleTheme найден в {handlers}"
    assert handlers == ["editor.js"], f"единственный click-handler должен быть в editor.js: {handlers}"
    # Единственный обработчик привязан именно к #theme-toggle-btn.
    assert "getElementById('theme-toggle-btn')" in JS["editor.js"]


# ─────────────────────────────────────────────────────────────
# 3. toggleTheme и loadTheme используют один ключ academic_writer_theme
# ─────────────────────────────────────────────────────────────
def test_toggle_theme_and_load_theme_use_single_key():
    editor = JS["editor.js"]
    # toggleTheme пишет, loadTheme читает — оба по одному ключу.
    assert "localStorage.setItem('academic_writer_theme'" in editor
    assert "localStorage.getItem('academic_writer_theme'" in editor
    # Короткий ключ 'theme' (источник рассинхрона) не должен встречаться в JS.
    for name, text in JS.items():
        assert "localStorage.getItem('theme')" not in text, f"{name}: остался getItem('theme')"
        assert "localStorage.setItem('theme'," not in text, f"{name}: остался setItem('theme')"


# ─────────────────────────────────────────────────────────────
# 4. #theme-toggle-btn-left больше не используется
# ─────────────────────────────────────────────────────────────
def test_theme_toggle_btn_left_no_longer_used():
    for name, text in JS.items():
        assert "theme-toggle-btn-left" not in text, f"{name}: theme-toggle-btn-left ещё используется"
    assert "theme-toggle-btn-left" not in HTML_FILE.read_text(encoding="utf-8")


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
