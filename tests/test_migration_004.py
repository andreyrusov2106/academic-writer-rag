"""
Статические проверки data-fix миграции 004_backfill_free_requests_limit.sql.

Миграция должна увеличить лимит бесплатных запросов Free с 10 до 100 ТОЛЬКО для
существующих free-пользователей со старым лимитом 10, не затрагивая:
  - пользователей с другим subscription_type (pro и пр.);
  - пользователей с иным значением requests_limit (кастомные значения).

Это регрессионные проверки на уровне исходника SQL: они фиксируют, что UPDATE
остаётся точечным и не превращается в безусловный сброс лимита у всех пользователей.
"""

from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parent.parent
    / "backend" / "db" / "migrations" / "004_backfill_free_requests_limit.sql"
).read_text(encoding="utf-8")


def test_update_targets_requests_limit_100():
    assert "SET requests_limit = 100" in MIGRATION


def test_where_restricts_to_free_plan():
    # Только free-пользователи, не pro и не все подряд.
    assert "subscription_type = 'free'" in MIGRATION


def test_where_restricts_to_old_limit_10():
    # Только строки со старым лимитом 10; прочие значения не трогаем.
    assert "requests_limit = 10" in MIGRATION


def test_no_unconditional_update():
    # Без WHERE-условия UPDATE затронул бы всех пользователей — этого быть не должно.
    assert "WHERE subscription_type = 'free'" in MIGRATION


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
