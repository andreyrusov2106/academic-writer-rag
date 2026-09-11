"""
Статические тесты Service Worker (U-3: stale cache при деплое).

Проверяют, что sw.js версионирует кэш, активируется сразу (skipWaiting/
clientsClaim) и для навигации использует network-first с обновлением кэша
и fallback'ом на кэш при отсутствии сети.
"""

from pathlib import Path

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
SW_JS = FRONTEND_DIR / "sw.js"


def _sw_js() -> str:
    return SW_JS.read_text(encoding="utf-8")


def test_cache_name_is_v2():
    js = _sw_js()
    assert "academic-writer-v2" in js, "CACHE_NAME не содержит academic-writer-v2"


def test_skip_waiting_present():
    assert "self.skipWaiting()" in _sw_js(), \
        "install не вызывает self.skipWaiting()"


def test_clients_claim_present():
    assert "self.clients.claim()" in _sw_js(), \
        "activate не вызывает self.clients.claim()"


def test_navigation_mode_handled():
    assert "event.request.mode === 'navigate'" in _sw_js(), \
        "нет отдельной обработки navigation request"


def test_navigation_uses_network_first():
    js = _sw_js()
    assert "fetch(event.request)" in js, \
        "navigation не делает fetch(event.request)"


def test_navigation_caches_network_response():
    js = _sw_js()
    assert "caches.open(CACHE_NAME)" in js, \
        "network response не сохраняется в CACHE_NAME"
    assert ".put(" in js or "cache.put" in js, \
        "нет записи ответа в кэш (cache.put)"


def test_navigation_falls_back_to_cache():
    assert "caches.match(event.request)" in _sw_js(), \
        "нет fallback'а через caches.match(event.request)"


def test_activate_deletes_other_caches():
    js = _sw_js()
    assert "name !== CACHE_NAME" in js, \
        "activate не фильтрует кэши по CACHE_NAME"
    assert "caches.delete(name)" in js, \
        "activate не удаляет старые кэши"


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
