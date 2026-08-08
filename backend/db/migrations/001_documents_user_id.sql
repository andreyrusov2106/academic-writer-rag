ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);

-- Пересоздать функцию поиска с фильтром по пользователю.
-- ВНИМАНИЕ КОДЕРУ: сначала посмотри текущее определение на сервере
-- (SELECT prosrc FROM pg_proc WHERE proname = 'match_documents';)
-- и сохрани ту же логику similarity/threshold, добавив ТОЛЬКО фильтр:
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector, match_count int, match_threshold float, filter_user_id int
) RETURNS table(id int, title text, article_url text, chunk_text text, similarity float)
LANGUAGE sql STABLE AS $$
    SELECT id, title, article_url, chunk_text,
           1 - (embedding <=> query_embedding) AS similarity
    FROM documents
    WHERE (user_id IS NULL OR user_id = filter_user_id)
      AND 1 - (embedding <=> query_embedding) > match_threshold
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$;
