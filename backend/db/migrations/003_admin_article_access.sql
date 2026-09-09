-- Миграция: доступ администратора к статьям.
--
-- Добавляет:
--   1. users.is_admin — флаг администратора (источник истины: только БД).
--   2. users.specialty_code — код специальности пользователя (для доступа по специальности).
--   3. document_access_users — доступ к статье для конкретного пользователя.
--   4. document_access_specialties — доступ к статье для целой специальности.
--   5. match_documents — пересоздаётся с дополнительным параметром filter_specialty_code,
--      сохраняя обратную совместимость и добавляя фильтрацию доступа.
--
-- Ключ доступа — article_url, а не documents.id, потому что documents.id — это идентификатор
-- отдельного чанка, а правила доступа задаются на уровне всей статьи (article_url).

-- ── 1. Флаг администратора и специальность пользователя ────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS specialty_code VARCHAR(32);

-- ── 2. Таблицы правил доступа (many-to-many, ключ — article_url) ───────────
CREATE TABLE IF NOT EXISTS document_access_users (
    article_url TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (article_url, user_id)
);

CREATE TABLE IF NOT EXISTS document_access_specialties (
    article_url TEXT NOT NULL,
    specialty_code VARCHAR(32) NOT NULL,
    PRIMARY KEY (article_url, specialty_code)
);

-- ── 3. Пересоздание match_documents с фильтрацией доступа ───────────────────
-- ВНИМАНИЕ КОДЕРУ: перед применением сверь текущее определение на сервере:
--   SELECT prosrc FROM pg_proc WHERE proname = 'match_documents';
-- Логика similarity/threshold сохранена, добавлен ТОЛЬКО фильтр доступа.
--
-- Правила доступа:
--   A. documents.user_id = filter_user_id  ->  доступ владельцу (личные документы).
--   B. documents.user_id IS NULL (административные/общие статьи):
--      - нет ни одного правила в обеих access-таблицах -> доступ всем;
--      - пользователь указан в document_access_users -> доступ;
--      - specialty_code пользователя совпадает с document_access_specialties -> доступ;
--      - правила существуют, но ни одно не совпало -> доступа нет.
--   Логика прямого пользователя и специальности — OR.

-- Удаляем старую 4-аргументную перегрузку, чтобы после применения миграции
-- не осталось одновременно старой и новой версий функции (в PostgreSQL
-- CREATE OR REPLACE заменяет функцию только при совпадении списка аргументов).
DROP FUNCTION IF EXISTS match_documents(vector, integer, double precision, integer);

CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector,
    match_count int,
    match_threshold float,
    filter_user_id int,
    filter_specialty_code text
) RETURNS table(id int, title text, article_url text, chunk_text text, similarity float)
LANGUAGE sql STABLE AS $$
    SELECT id, title, article_url, chunk_text,
           1 - (embedding <=> query_embedding) AS similarity
    FROM documents d
    WHERE 1 - (embedding <=> query_embedding) > match_threshold
      AND (
        d.user_id = filter_user_id
        OR (
          d.user_id IS NULL
          AND (
            (
              NOT EXISTS (SELECT 1 FROM document_access_users au WHERE au.article_url = d.article_url)
              AND NOT EXISTS (SELECT 1 FROM document_access_specialties asp WHERE asp.article_url = d.article_url)
            )
            OR EXISTS (SELECT 1 FROM document_access_users au WHERE au.article_url = d.article_url AND au.user_id = filter_user_id)
            OR (
              filter_specialty_code IS NOT NULL
              AND EXISTS (SELECT 1 FROM document_access_specialties asp WHERE asp.article_url = d.article_url AND asp.specialty_code = filter_specialty_code)
            )
          )
        )
      )
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$;
