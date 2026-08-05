from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import psycopg2
import requests
import logging
import json
import re
import pdfplumber
from dataclasses import dataclass, field
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv
from datetime import datetime, timedelta
from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr

# --- НАСТРОЙКИ БЕЗОПАСНОСТИ ---
SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # Токен живет 7 дней

security = HTTPBearer()

# --- МОДЕЛИ ДЛЯ АВТОРИЗАЦИИ ---
class UserCreate(BaseModel):
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user_id: int
    subscription_type: str
    requests_used: int = 0      # ✅ Добавлено
    requests_limit: int = 0     # ✅ Добавлено

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════
# НАСТРОЙКИ
# ═══════════════════════════════════════════════════════════
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

EMBED_MODEL_NAME = "intfloat/multilingual-e5-small"
EMBED_DIM = 384
MAX_CHUNK = 2500
MIN_CHUNK = 300
UPLOAD_DIR = "uploaded_pdfs"
os.makedirs(UPLOAD_DIR, exist_ok=True)

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()

# ═══════════════════════════════════════════════════════════
# ИНИЦИАЛИЗАЦИЯ
# ══════════════════════════════════════════════════════════
app = FastAPI(title="RAG Agent API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

log.info(f"Загрузка модели {EMBED_MODEL_NAME}...")
embed_model = SentenceTransformer(EMBED_MODEL_NAME)
log.info("✓ Модель загружена")

# ═══════════════════════════════════════════════════════════
# МОДЕЛИ ЗАПРОСОВ
# ═══════════════════════════════════════════════════════════
class QueryRequest(BaseModel):
    question: str
    match_count: int = 5
    match_threshold: float = 0.2
    dual_language: bool = False
    history: list[dict] = []  

class QueryResponse(BaseModel):
    answer: str
    answer_cn: str = ""
    sources: list[dict]
    similarity_scores: list[float]

class SmartActionRequest(BaseModel):
    text: str
    action: str  # 'rewrite_scientific', 'translate_cn', 'find_sources', 'fix_style'

class SmartActionResponse(BaseModel):
    result: str
    sources: list[dict] = []

# ═══════════════════════════════════════════════════════════
# ФУНКЦИИ РАБОТЫ С БД
# ═══════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════
# АГЕНТНЫЙ ПОИСК В OPENALEX (АВТОМАТИЧЕСКИЙ)
# ═══════════════════════════════════════════════════════════
def search_openalex(query: str, limit: int = 5) -> list[dict]:
    """Продвинутый поиск в OpenAlex: только журналы, сортировка по цитированиям, умный запрос"""
    try:
        # 1. Умная подготовка запроса (сужаем до антропологии и культурологии)
        search_query = query
        q_lower = query.lower()
        
        # Если запрос общий, добавляем ключевые слова для фильтрации по области
        if "этнограф" in q_lower or "культур" in q_lower or "антропол" in q_lower:
            search_query = f"({query}) AND (anthropology OR ethnography OR cultural studies)"
        
        safe_query = requests.utils.quote(search_query)
        
        # 2. НАСТРОЙКА ФИЛЬТРОВ И СОРТИРОВКИ
        # filter=type:article (только статьи)
        # filter=primary_location.source.type:journal (только рецензируемые журналы)
        # filter=from_publication_date:2015-01-01 (свежие статьи)
        # sort=cited_by_count:desc (сначала самые цитируемые!)
        url = (
            f"https://api.openalex.org/works?search={safe_query}"
            f"&per_page={limit}"
            f"&sort=cited_by_count:desc"
            f"&filter=type:article,primary_location.source.type:journal,from_publication_date:2015-01-01"
        )
        
        log.info(f"🔍 Продвинутый поиск OpenAlex (журналы, по цитированиям): '{search_query}'")
        resp = requests.get(url, timeout=15)
        if not resp.ok:
            log.warning(f"OpenAlex вернул ошибку: {resp.status_code}")
            return []
            
        data = resp.json()
        results = []
        
        for work in data.get('results', []):
            title = work.get('title', 'Без названия')
            year = work.get('publication_year', 'н/д')
            authors = ", ".join([a['author']['display_name'] for a in work.get('authorships', [])[:3]])
            doi = work.get('doi', '')
            
            # ✅ Получаем количество цитирований
            citations = work.get('cited_by_count', 0)
            
            # ✅ Извлекаем аннотацию
            abstract = work.get('abstract')
            if not abstract and work.get('abstract_inverted_index'):
                abstract = " ".join(sorted(
                    [word for word, positions in work['abstract_inverted_index'].items() for _ in positions],
                    key=lambda x: work['abstract_inverted_index'][x][0]
                ))
            abstract = abstract or "Аннотация отсутствует в открытом доступе."
            # Обрезаем аннотацию до 1000 символов, чтобы не превысить лимит токенов
            if len(abstract) > 1000:
                abstract = abstract[:1000] + "..."

            abstract_text = f"Научная статья: «{title}». Авторы: {authors}. Год: {year}.\nАННОТАЦИЯ: {abstract}"
            
            # ✅ Формируем текст с акцентом на авторитетность источника
            citation_note = f" (Высокоцитируемая работа: {citations} цитирований)" if citations > 50 else f" ({citations} цитирований)"
            
            abstract_text = (
                f"Научная статья: «{title}». "
                f"Авторы: {authors}. Год: {year}. "
                f"Цитирований: {citations}{citation_note}.\n"
                f"АННОТАЦИЯ: {abstract}"
            )
            
            results.append({
                "title": f"🌐 {title}",
                "article_url": doi.replace("https://doi.org/", "") if doi else "",
                "chunk_text": abstract_text,
                "similarity": 0.95,
                "is_online": True
            })
            
        log.info(f"✓ Найдено {len(results)} авторитетных статей в OpenAlex")
        return results
    except Exception as e:
        log.error(f"Ошибка поиска в OpenAlex: {e}")
        return []

# --- ФУНКЦИИ БЕЗОПАСНОСТИ ---
def verify_password(plain_password, hashed_password) -> bool:
    password_byte_enc = plain_password.encode('utf-8')
    hashed_byte_enc = hashed_password.encode('utf-8')
    return bcrypt.checkpw(password_byte_enc, hashed_byte_enc)

def get_password_hash(password: str) -> str:
    password_byte_enc = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_byte_enc, salt)
    return hashed.decode('utf-8')

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# --- ФУНКЦИИ БД ДЛЯ АВТОРИЗАЦИИ ---
def get_user_by_email(email: str):
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT id, email, hashed_password, subscription_type, requests_used, requests_limit FROM users WHERE email = %s", (email,))
            user = cur.fetchone()
            conn.close()
            if user:
                return {
                    "id": user[0], "email": user[1], "hashed_password": user[2],
                    "subscription_type": user[3], "requests_used": user[4], "requests_limit": user[5]
                }
        return None
    except Exception as e:
        log.error(f"Ошибка получения юзера: {e}")
        return None

def create_user_in_db(email: str, hashed_password: str):
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (email, hashed_password) VALUES (%s, %s) RETURNING id", 
                (email, hashed_password)
            )
            user_id = cur.fetchone()[0]
            conn.commit()
            conn.close()
            return user_id
    except Exception as e:
        log.error(f"Ошибка создания юзера: {e}")
        return None

def increment_user_requests(user_id: int):
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET requests_used = requests_used + 1 WHERE id = %s", (user_id,))
            conn.commit()
            conn.close()
    except Exception as e:
        log.error(f"Ошибка обновления счетчика: {e}")

def get_db_connection():
    ssl_mode = 'require' if DB_HOST not in ['127.0.0.1', 'localhost', 'db'] else None
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD,
        sslmode=ssl_mode
    )

def get_embedding(text: str) -> list[float]:
    embedding = embed_model.encode([text], normalize_embeddings=True)
    return embedding[0].tolist()

def search_documents(query_embedding: list[float], match_count=5, match_threshold=0.2):
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, title, article_url, chunk_text, similarity 
                FROM match_documents(%s::vector, %s, %s)
                """,
                (query_embedding, match_count, match_threshold)
            )
            results = cur.fetchall()
        conn.close()
        return [
            {
                "id": r[0], "title": r[1], "article_url": r[2],
                "chunk_text": r[3], "similarity": r[4]
            }
            for r in results
        ]
    except Exception as e:
        log.error(f"Ошибка поиска: {e}")
        return []

# ══════════════════════════════════════════════════════════
# ФУНКЦИИ ОБРАБОТКИ PDF
# ═══════════════════════════════════════════════════════════
@dataclass
class Chunk:
    article_url: str
    title: str
    chunk_index: int
    text: str
    embedding: list = field(default_factory=list)

def pdf_to_text(path: str) -> str:
    pages = []
    try:
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                t = page.extract_text(x_tolerance=2, y_tolerance=2)
                if t:
                    pages.append(t)
    except Exception as e:
        log.error(f"Ошибка чтения PDF: {e}")
    return "\n".join(pages)

def clean_text(text: str) -> str:
    text = re.sub(r"-\n(\w)", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def to_chunks(text: str) -> list[str]:
    result = []
    for para in text.split("\n\n"):
        para = para.strip()
        if not para:
            continue
        if len(para) <= MAX_CHUNK:
            if len(para) >= MIN_CHUNK:
                result.append(para)
        else:
            buf = ""
            for sent in re.split(r"(?<=[.!?])\s+", para):
                if len(buf) + len(sent) + 1 <= MAX_CHUNK:
                    buf = (buf + " " + sent).strip() if buf else sent
                else:
                    if len(buf) >= MIN_CHUNK:
                        result.append(buf)
                    buf = sent
            if len(buf) >= MIN_CHUNK:
                result.append(buf)
    return result

def get_embeddings(texts: list[str]) -> list[list[float]]:
    embeddings = embed_model.encode(
        texts, batch_size=32, show_progress_bar=False, normalize_embeddings=True
    )
    return embeddings.tolist()

def save_chunks_to_db(chunks: list[Chunk]) -> int:
    conn = get_db_connection()
    rows = [
        (c.article_url, c.title, c.chunk_index, c.text, c.embedding)
        for c in chunks
    ]
    try:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(
                    """
                    INSERT INTO documents (article_url, title, chunk_index, chunk_text, embedding)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (article_url, chunk_index) 
                    DO UPDATE SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding
                    """,
                    row
                )
        conn.commit()
        return len(rows)
    except Exception as e:
        log.error(f"Ошибка сохранения: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

def process_pdf(file_path: str, filename: str) -> dict:
    raw_text = pdf_to_text(file_path)
    if not raw_text.strip():
        return {"success": False, "error": "Не удалось извлечь текст из PDF"}
    
    text = clean_text(raw_text)
    chunks_text = to_chunks(text)
    if not chunks_text:
        return {"success": False, "error": "Текст слишком короткий для обработки"}
    
    embeddings = get_embeddings(chunks_text)
    
    chunks = [
        Chunk(
            article_url=filename,
            title=filename,
            chunk_index=i,
            text=t,
            embedding=emb,
        )
        for i, (t, emb) in enumerate(zip(chunks_text, embeddings))
    ]
    
    count = save_chunks_to_db(chunks)
    return {
        "success": True,
        "chunks": count,
        "text_length": len(text),
        "message": f"Обработано {count} чанков"
    }

# ═══════════════════════════════════════════════════════════
# ФУНКЦИЯ LLM
# ═══════════════════════════════════════════════════════════
def ask_llm(question: str, context: str, history: list[dict], dual_language: bool = False) -> dict:
    """Генерация ответа через DeepSeek с учетом истории диалога"""
    if not DEEPSEEK_API_KEY:
        return {"answer_ru": "⚠️ Не задан DEEPSEEK_API_KEY", "answer_cn": ""}
    
    url = "https://api.deepseek.com/v1/chat/completions"
    
    # Системный промпт (личность профессора)
    system_prompt = """Ты — Наталья Петровна Копцева, профессор, доктор культурологических наук. 
Отвечай тепло, но академично. Обращайся на "Вы". 
Отвечай СТРОГО на основе предоставленных научных материалов. Если информации нет — честно скажи об этом."""

    # Формируем список сообщений для API
    messages = [{"role": "system", "content": system_prompt}]
    
    # Добавляем историю (последние 6 сообщений = 3 пары вопрос-ответ)
    for msg in history[-6:]:
        messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
    
    # Добавляем контекст и текущий вопрос
    if dual_language:
        current_prompt = f"""ВАЖНО: Дай ответ НА ДВУХ ЯЗЫКАХ в формате:
[RU] (ответ на русском)
[CN] (ответ на китайском, для научных терминов добавляй русский перевод в скобках, например: 文化研究方法 (методы культурологии))

КОНТЕКСТ (научные материалы):
{context}

ВОПРОС: {question}
ОТВЕТ:"""
    else:
        current_prompt = f"""КОНТЕКСТ (научные материалы):
{context}

ВОПРОС: {question}

ОТВЕТ:"""
    
    messages.append({"role": "user", "content": current_prompt})

    try:
        resp = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "deepseek-v4-flash",
                "messages": messages,  # ← Теперь передаем список сообщений
                "temperature": 0.4,
                "max_tokens": 2000 if dual_language else 1000
            },
            timeout=90
        )
        
        if not resp.ok:
            log.error(f"❌ Ошибка DeepSeek API: статус {resp.status_code}")
            return {"answer_ru": f"⚠️ Ошибка API ({resp.status_code})", "answer_cn": ""}
        
        full_answer = resp.json()["choices"][0]["message"]["content"]
        
        if dual_language:
            parts = full_answer.split("[CN]")
            answer_ru = parts[0].replace("[RU]", "").strip()
            answer_cn = parts[1].strip() if len(parts) > 1 else ""
            return {"answer_ru": answer_ru, "answer_cn": answer_cn}
        else:
            return {"answer_ru": full_answer, "answer_cn": ""}
    except Exception as e:
        log.error(f"❌ Критическая ошибка DeepSeek: {e}")
        return {"answer_ru": f"️ Ошибка: {e}", "answer_cn": ""}

# ═══════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════
@app.get("/")
async def root():
    return {"status": "ok", "message": "RAG Agent API работает", "version": "1.0.0"}

@app.post("/ask", response_model=QueryResponse)
async def ask_question(request: QueryRequest):
    try:
        log.info(f"Получен вопрос: {request.question} (dual_language: {request.dual_language})")
        query_embedding = get_embedding(request.question)
        results = search_documents(
            query_embedding,
            match_count=request.match_count,
            match_threshold=request.match_threshold
        )
        
        if not results:
            return QueryResponse(
                answer="К сожалению, в базе знаний нет информации по этому вопросу.",
                answer_cn="抱歉，知识库中没有相关信息。",
                sources=[],
                similarity_scores=[]
            )
        
        context = "\n\n---\n\n".join([
            f"[{i+1}] Источник: {r['title']}\n{r['chunk_text']}"
            for i, r in enumerate(results)
        ])
        
        answer_dict = ask_llm(request.question, context, history=request.history, dual_language=request.dual_language)
        
        sources = [
            {
                "title": r["title"],
                "article_url": r["article_url"],
                "chunk_text": r["chunk_text"][:200] + "..."
            }
            for r in results
        ]
        similarity_scores = [r["similarity"] for r in results]
        
        return QueryResponse(
            answer=answer_dict["answer_ru"],
            answer_cn=answer_dict["answer_cn"],
            sources=sources,
            similarity_scores=similarity_scores
        )
    except Exception as e:
        log.error(f"Ошибка обработки запроса: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/auth/register", response_model=dict)
async def register(user: UserCreate):
    db_user = get_user_by_email(user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже существует")
    
    hashed_pw = get_password_hash(user.password)
    user_id = create_user_in_db(user.email, hashed_pw)
    
    if not user_id:
        raise HTTPException(status_code=500, detail="Ошибка при регистрации")
        
    return {"message": "Успешная регистрация", "user_id": user_id}

@app.post("/auth/login", response_model=Token)
async def login(user: UserLogin):
    db_user = get_user_by_email(user.email)
    if not db_user or not verify_password(user.password, db_user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    access_token = create_access_token(data={"sub": db_user["email"], "user_id": db_user["id"]})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": db_user["id"],
        "subscription_type": db_user["subscription_type"],
        "requests_used": db_user["requests_used"],       # ✅ Добавлено
        "requests_limit": db_user["requests_limit"]      # ✅ Добавлено
    }

# --- ЗАВИСИМОСТЬ ДЛЯ ПРОВЕРКИ ТОКЕНА ---
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        user_id: int = payload.get("user_id")
        if email is None or user_id is None:
            raise HTTPException(status_code=401, detail="Невалидный токен")
        
        # Проверяем, что юзер все еще есть в базе и получаем его актуальные лимиты
        db_user = get_user_by_email(email)
        if not db_user or db_user["id"] != user_id:
            raise HTTPException(status_code=401, detail="Пользователь не найден")
            
        return db_user
    except JWTError:
        raise HTTPException(status_code=401, detail="Невалидный токен")

@app.post("/ask-stream")
async def ask_question_stream(
    request: QueryRequest, 
    current_user: dict = Depends(get_current_user) # ✅ Добавляем проверку токена
):
    # ✅ ПРОВЕРКА ЛИМИТОВ
    if current_user["requests_used"] >= current_user["requests_limit"]:
        raise HTTPException(
            status_code=403, 
            detail=f"Лимит запросов исчерпан. Ваш текущий тариф: {current_user['subscription_type']}. Обновите подписку."
        )
    async def generate():
        try:
            query_embedding = get_embedding(request.question)
            results = search_documents(
                query_embedding,
                match_count=request.match_count,
                match_threshold=request.match_threshold
            )

             # 🤖 АГЕНТНАЯ ЛОГИКА: Приоритет локальной базы
            is_online_search_needed = False
            local_similarity = results[0]['similarity'] if results else 0

            

            # Идём в OpenAlex ТОЛЬКО если:
            # 1. Локальная база вообще ничего не нашла (results пустой)
            # 2. ИЛИ схожесть ОЧЕНЬ низкая (< 0.25) — это явный мусор
            if not results or local_similarity < 0.25:
                is_online_search_needed = True
            log.info(f"📊 Локальная схожесть: {local_similarity:.3f} | Найдено чанков: {len(results)} | Идём в OpenAlex: {is_online_search_needed}")  
            # ⚠️ УБРАЛИ триггеры по словам "современн" и "2024" — они заставляли 
            # систему игнорировать локальную базу даже при хороших результатах
                
            if is_online_search_needed:
                log.info(f"🤖 Локальная база не знает ответа (схожесть: {local_similarity}) или запрос требует свежих данных. Запускаю поиск в OpenAlex...")
                online_results = search_openalex(request.question, limit=5) # Увеличили до 5
                
                if not online_results:
                    yield f"data: {json.dumps({'type': 'answer', 'content': 'К сожалению, ни в локальной базе, ни в открытых научных репозиториях (OpenAlex) не удалось найти релевантные современные публикации по вашему запросу. Попробуйте переформулировать вопрос или использовать английские термины (например, digital ethnography).'}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                    return
                    
                results = online_results
                log.info(f"✓ Успешно получено {len(online_results)} статей из OpenAlex")
                log.info(f" Формируем контекст для LLM...")
                log.info(f"🔑 DEEPSEEK_API_KEY задан: {bool(DEEPSEEK_API_KEY)}")
            
            

                
            # Формируем контекст
            context = "\n\n---\n\n".join([
                f"[{i+1}] Источник: {r['title']}\n{r['chunk_text']}"
                for i, r in enumerate(results)
            ])
            
            if is_online_search_needed:
                context = "ВНИМАНИЕ: В локальной базе не было достаточно информации, поэтому я нашел следующие статьи в открытых научных репозиториях (OpenAlex). Используй их для ответа:\n\n" + context
                
            sources = [
                {
                    "title": r["title"],
                    "article_url": r["article_url"],
                    "chunk_text": r["chunk_text"][:200] + "...",
                    "is_online": r.get("is_online", False)
                }
                for r in results
            ]
            
            yield f"data: {json.dumps({'type': 'sources', 'sources': sources, 'similarity_scores': [r['similarity'] for r in results]}, ensure_ascii=False)}\n\n"
            
            if not DEEPSEEK_API_KEY:
                yield f"data: {json.dumps({'type': 'answer', 'content': '⚠️ Не задан DEEPSEEK_API_KEY'}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                return
                
            url = "https://api.deepseek.com/v1/chat/completions"
            
            # ✅ УСИЛЕННЫЙ СИСТЕМНЫЙ ПРОМПТ (Строгая инструкция использовать контекст)
            system_prompt = """Ты — Наталья Петровна Копцева, профессор, доктор культурологических наук. 
            Отвечай тепло, но академично, обращаясь на "Вы".
            Твоя задача — помочь исследователю. ОТВЕЧАЙ СТРОГО НА ОСНОВЕ ПРЕДОСТАВЛЕННОГО КОНТЕКСТА.

            ВАЖНОЕ ПРАВИЛО: Внимательно анализируй весь текст. Если информация о рубриках, отделах, структуре издания или методах разбросана по разным абзацам, собери её в единый структурированный список. Не требуй наличия формального "оглавления", если факты прямо упомянуты в тексте статьи.
            Если информации действительно нет, честно скажи об этом, но постарайся дать максимально полезный академический комментарий на основе того, что есть."""
            
            messages = [{"role": "system", "content": system_prompt}]
            for msg in request.history[-6:]:
                messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
            
            # ✅ УСИЛЕННЫЙ ПОЛЬЗОВАТЕЛЬСКИЙ ПРОМПТ
            current_prompt = f"""КОНТЕКСТ (научные материалы):
{context}

ВОПРОС: {request.question}

ОТВЕТ (опираясь на контекст):"""
            messages.append({"role": "user", "content": current_prompt})
            log.info(f"🚀 Отправляю запрос к DeepSeek API...")
            log.info(f"📊 Размер контекста: {len(context)} символов")
            resp = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek-v4-flash",
                    "messages": messages,
                    "temperature": 0.4,
                    "max_tokens": 2000,
                    "stream": True
                },
                stream=True,
                timeout=90
            )
            
            if not resp.ok:
                log.error(f"❌ Ошибка DeepSeek Stream: {resp.status_code}, текст: {resp.text}")
                yield f"data: {json.dumps({'type': 'error', 'content': f'Ошибка API: {resp.text}'}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
                return
                
            for line in resp.iter_lines():
                if line:
                    line = line.decode('utf-8')
                    if line.startswith('data: '):
                        data = line[6:]
                        if data == '[DONE]':
                            break
                        try:
                            chunk = json.loads(data)
                            if 'choices' in chunk and len(chunk['choices']) > 0:
                                delta = chunk['choices'][0].get('delta', {})
                                content = delta.get('content', '')
                                if content:
                                    yield f"data: {json.dumps({'type': 'answer', 'content': content}, ensure_ascii=False)}\n\n"
                        except json.JSONDecodeError:
                            continue
                            
            increment_user_requests(current_user["id"])
            log.info(f"✅ Запрос засчитан. Пользователь {current_user['email']}: {current_user['requests_used'] + 1}/{current_user['requests_limit']}")
            
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"
            
        except Exception as e:
            log.error(f"Ошибка стриминга: {e}")
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    try:
        if not file.filename.endswith('.pdf'):
            return {"success": False, "error": "Можно загружать только PDF файлы"}
        
        file_path = os.path.join(UPLOAD_DIR, file.filename)
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        log.info(f"Загружен файл: {file.filename} ({len(content)} байт)")
        
        result = process_pdf(file_path, file.filename)
        
        if result["success"]:
            log.info(f"✓ Файл {file.filename} обработан: {result['chunks']} чанков")
            return {
                "success": True,
                "message": "Файл успешно загружен и обработан",
                "chunks": result["chunks"],
                "text_length": result["text_length"]
            }
        else:
            return {"success": False, "error": result["error"]}
    except Exception as e:
        log.error(f"Ошибка загрузки PDF: {e}")
        return {"success": False, "error": str(e)}

@app.post("/smart-action")
async def smart_action(request: SmartActionRequest):
    """Умные действия с выделенным текстом"""
    try:
        log.info(f"Smart action: {request.action}, текст: {request.text[:50]}...")
        
        prompts = {
            'rewrite_scientific': f"""Перепиши следующий текст в более научном, академическом стиле. 
Сохрани смысл, но используй научную терминологию, пассивные конструкции, избегай разговорных выражений.
Отвечай ТОЛЬКО переработанным текстом, без комментариев.

ИСХОДНЫЙ ТЕКСТ:
{request.text}

ПЕРЕРАБОТАННЫЙ ТЕКСТ:""",
            
            'translate_cn': f"""Переведи следующий текст на китайский язык (中文). 
Для научных терминов добавляй русское пояснение в скобках.
Отвечай ТОЛЬКО переводом, без комментариев.

ТЕКСТ ДЛЯ ПЕРЕВОДА:
{request.text}

ПЕРЕВОД:""",
            
            'find_sources': f"""Найди в предоставленных научных материалах информацию, 
которая подтверждает, дополняет или противоречит следующему утверждению.
Если ничего не найдено — честно скажи об этом.

УТВЕРЖДЕНИЕ:
{request.text}

КОНТЕКСТ (научные материалы):
PLACEHOLDER_CONTEXT

ОТВЕТ:""",
            
            'fix_style': f"""Исправь грамматические, пунктуационные и стилистические ошибки в тексте.
Сохрани авторский стиль и смысл. Отвечай ТОЛЬКО исправленным текстом, без комментариев.

ТЕКСТ:
{request.text}

ИСПРАВЛЕННЫЙ ТЕКСТ:"""
        }
        
        prompt = prompts.get(request.action)
        if not prompt:
            return SmartActionResponse(result="Неизвестное действие", sources=[])
        
        sources = []
        if request.action == 'find_sources':
            query_embedding = get_embedding(request.text)
            search_results = search_documents(query_embedding, match_count=3, match_threshold=0.3)
            
            if search_results:
                context = "\n\n---\n\n".join([
                    f"[{i+1}] {r['title']}: {r['chunk_text']}" 
                    for i, r in enumerate(search_results)
                ])
                prompt = prompt.replace("PLACEHOLDER_CONTEXT", context)
                sources = [
                    {"title": r["title"], "chunk_text": r["chunk_text"][:150] + "..."}
                    for r in search_results
                ]
            else:
                prompt = prompt.replace("PLACEHOLDER_CONTEXT", "(источники не найдены)")
        
        if not DEEPSEEK_API_KEY:
            return SmartActionResponse(result="⚠️ Не задан DEEPSEEK_API_KEY", sources=sources)
        
        url = "https://api.deepseek.com/v1/chat/completions"
        resp = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "deepseek-v4-flash",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": 1500
            },
            timeout=60
        )
        
        if not resp.ok:
            log.error(f"Ошибка smart-action: {resp.status_code} - {resp.text}")
            return SmartActionResponse(result=f"⚠️ Ошибка API: {resp.status_code}", sources=sources)
        
        result = resp.json()["choices"][0]["message"]["content"]
        return SmartActionResponse(result=result, sources=sources)
        
    except Exception as e:
        log.error(f"Ошибка smart-action: {e}")
        return SmartActionResponse(result=f"️ Ошибка: {e}", sources=[])

@app.get("/health")
async def health_check():
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM documents")
            count = cur.fetchone()[0]
        conn.close()
        return {
            "status": "healthy",
            "database": "connected",
            "documents_count": count
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e)
        }

# ═══════════════════════════════════════════════════════════
# ЗАПУСК
# ═══════════════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn
    log.info("=" * 60)
    log.info("Запуск RAG Agent API...")
    log.info("API: http://localhost:8000")
    log.info("Docs: http://localhost:8000/docs")
    log.info("=" * 60)
#    uvicorn.run(app, host="0.0.0.0", port=8000)