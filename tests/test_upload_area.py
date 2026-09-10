"""
Статические проверки: блок загрузки PDF не должен дублироваться.

Проверяют, что:
  - в academic-writer.html ровно по одному элементу с id="upload-area", "pdf-input", "drop-zone";
  - loadDocuments() в chat.js не копирует upload-area через outerHTML в #sources-list.
"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
HTML_FILE = FRONTEND_DIR / "academic-writer.html"
CHAT_JS = FRONTEND_DIR / "js" / "chat.js"


def _read(path):
    return path.read_text(encoding="utf-8")


def test_upload_area_ids_are_unique_in_html():
    html = _read(HTML_FILE)
    for elem_id in ("upload-area", "pdf-input", "drop-zone"):
        assert html.count(f'id="{elem_id}"') == 1, (
            f'id="{elem_id}" должен встречаться ровно один раз в academic-writer.html'
        )


def test_load_documents_does_not_copy_upload_area():
    js = _read(CHAT_JS)
    # upload-area не должна вставляться в #sources-list через outerHTML.
    assert "outerHTML" not in js, "loadDocuments() не должен копировать upload-area через outerHTML"


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
