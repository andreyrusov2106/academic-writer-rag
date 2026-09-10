"""
Статические проверки rate limiting в nginx.conf (S-9).

Фиксируют минимальную production-защиту дорогих эндпоинтов:
  - auth_limit (5r/m) сохраняется и применяется к /api/auth/;
  - api_ai_limit (10r/m, burst=5 nodelay) применяется ТОЛЬКО к
    /api/ask, /api/ask-stream, /api/smart-action;
  - upload_limit (2r/m, burst=2 nodelay) применяется ТОЛЬКО к /api/upload;
  - в общем location /api/ (documents, health, admin и пр.) новый limit_req НЕ появляется.

Это регрессионные проверки на уровне исходника nginx.conf: они не запускают nginx,
а гарантируют, что конфигурация остаётся точечной и не превращается в лимит на все /api/.
"""

from pathlib import Path

NGINX_CONF = Path(__file__).resolve().parent.parent / "nginx.conf"
TEXT = NGINX_CONF.read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# Разбор location-блоков
# ─────────────────────────────────────────────────────────────
def _locations(text):
    """Возвращает список (path, body) для каждого location-блока."""
    locs = []
    i = 0
    while True:
        start = text.find("location", i)
        if start == -1:
            break
        brace = text.find("{", start)
        if brace == -1:
            break
        header = text[start:brace].strip()
        # Найти парную закрывающую скобку (вложенных {} в location нет).
        depth = 0
        j = brace
        while j < len(text):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = text[brace + 1 : j]
        locs.append((_loc_path(header), body))
        i = j + 1
    return dict(locs)


def _loc_path(header):
    # "location = /api/ask" -> "/api/ask"; "location /api/" -> "/api/".
    parts = header.split(None, 2)
    if len(parts) >= 3 and parts[1] == "=":
        return parts[2]
    if len(parts) >= 2:
        return parts[1]
    return header


LOCATIONS = _locations(TEXT)


# ─────────────────────────────────────────────────────────────
# Зоны limit_req_zone объявлены с нужными rate
# ─────────────────────────────────────────────────────────────
def test_auth_limit_zone_preserved():
    assert "limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/m;" in TEXT


def test_api_ai_limit_zone_declared():
    assert "limit_req_zone $binary_remote_addr zone=api_ai_limit:10m rate=10r/m;" in TEXT


def test_upload_limit_zone_declared():
    assert "limit_req_zone $binary_remote_addr zone=upload_limit:10m rate=2r/m;" in TEXT


# ─────────────────────────────────────────────────────────────
# auth_limit применяется только к /api/auth/
# ─────────────────────────────────────────────────────────────
def test_auth_limit_applied_to_auth_location():
    assert "zone=auth_limit" in LOCATIONS["/api/auth/"]
    assert "burst=10 nodelay" in LOCATIONS["/api/auth/"]


# ─────────────────────────────────────────────────────────────
# api_ai_limit применяется ТОЛЬКО к трём AI endpoints
# ─────────────────────────────────────────────────────────────
AI_PATHS = ["/api/ask", "/api/ask-stream", "/api/smart-action"]


def test_api_ai_limit_applied_to_each_ai_endpoint():
    for path in AI_PATHS:
        assert path in LOCATIONS, f"{path} location отсутствует"
        body = LOCATIONS[path]
        assert "zone=api_ai_limit" in body, f"{path}: нет api_ai_limit"
        assert "burst=5 nodelay" in body, f"{path}: неверный burst/nodelay"


def test_api_ai_limit_not_applied_to_other_locations():
    for path, body in LOCATIONS.items():
        if path not in AI_PATHS:
            assert "zone=api_ai_limit" not in body, f"{path} не должен иметь api_ai_limit"


# ─────────────────────────────────────────────────────────────
# upload_limit применяется только к /api/upload
# ─────────────────────────────────────────────────────────────
def test_upload_limit_applied_to_upload():
    assert "/api/upload" in LOCATIONS, "location /api/upload отсутствует"
    body = LOCATIONS["/api/upload"]
    assert "zone=upload_limit" in body
    assert "burst=2 nodelay" in body


def test_upload_limit_not_applied_to_other_locations():
    for path, body in LOCATIONS.items():
        if path != "/api/upload":
            assert "zone=upload_limit" not in body, f"{path} не должен иметь upload_limit"


# ─────────────────────────────────────────────────────────────
# Общий location /api/ (documents, health, admin) без нового лимита
# ─────────────────────────────────────────────────────────────
def test_generic_api_location_has_no_limit_req():
    assert "/api/" in LOCATIONS, "location /api/ отсутствует"
    assert "limit_req" not in LOCATIONS["/api/"]


def test_limit_req_appears_only_in_intended_locations():
    allowed = {"/api/auth/", "/api/ask", "/api/ask-stream", "/api/smart-action", "/api/upload"}
    limited = {path for path, body in LOCATIONS.items() if "limit_req" in body}
    assert limited == allowed, f"limit_req обнаружен в неожиданных location: {limited - allowed}"


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
