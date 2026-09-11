"""
Статические тесты ключей ГОСТ в localStorage (U-4: дублирующиеся keys).

Проверяют, что единственным рабочим ключом выбора ГОСТа остаётся `active_gost`,
а legacy-ключ `academic_writer_gost` больше не читается и не записывается.
"""

from pathlib import Path

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
JS_DIR = FRONTEND_DIR / "js"

APP_JS = JS_DIR / "app.js"
EDITOR_JS = JS_DIR / "editor.js"
CHAT_JS = JS_DIR / "chat.js"

LEGACY_KEY = "academic_writer_gost"


def _app_js() -> str:
    return APP_JS.read_text(encoding="utf-8")


def _editor_js() -> str:
    return EDITOR_JS.read_text(encoding="utf-8")


def _chat_js() -> str:
    return CHAT_JS.read_text(encoding="utf-8")


def _active_frontend_js_files():
    """Актуальные JS-файлы фронтенда (без .bak/.backup)."""
    files = sorted(JS_DIR.glob("*.js")) + sorted(FRONTEND_DIR.glob("*.js"))
    return files


def test_app_js_does_not_read_legacy_gost_key():
    js = _app_js()
    assert f"getItem('{LEGACY_KEY}')" not in js, \
        "app.js всё ещё читает academic_writer_gost через getItem"
    assert LEGACY_KEY not in js, \
        "app.js всё ещё ссылается на academic_writer_gost"


def test_editor_js_does_not_write_legacy_gost_key():
    js = _editor_js()
    assert f"setItem('{LEGACY_KEY}'" not in js, \
        "editor.js всё ещё записывает academic_writer_gost через setItem"
    assert LEGACY_KEY not in js, \
        "editor.js всё ещё ссылается на academic_writer_gost"


def test_active_gost_still_used_in_chat_js():
    js = _chat_js()
    assert "active_gost" in js, \
        "chat.js больше не использует active_gost"


def test_no_get_set_remove_legacy_gost_in_active_js():
    # Во всех актуальных frontend JS-файлах не должно быть ни одной
    # операции getItem/setItem/removeItem с legacy-ключом.
    offenders = []
    for f in _active_frontend_js_files():
        js = f.read_text(encoding="utf-8")
        for op in ("getItem", "setItem", "removeItem"):
            if f"{op}('{LEGACY_KEY}')" in js or f'{op}("{LEGACY_KEY}")' in js:
                offenders.append(f"{f.name}: {op}")
    assert not offenders, \
        "остались операции с academic_writer_gost: " + ", ".join(offenders)


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
