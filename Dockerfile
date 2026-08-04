FROM python:3.10-slim

WORKDIR /app

# Системные зависимости для psycopg2 и pdfplumber
RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Копируем зависимости и устанавливаем их
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь код
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Создаем папку для загруженных PDF
RUN mkdir -p /app/backend/uploaded_pdfs

# Открываем порт 7860 (требование Hugging Face)
EXPOSE 7860

# Запускаем приложение
CMD ["uvicorn", "backend.rag_api:app", "--host", "0.0.0.0", "--port", "7860"]