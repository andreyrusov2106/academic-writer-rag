// ═══════════════════════════════════════════════════════════
// АВТОРИЗАЦИЯ И ЧАТ
// ═══════════════════════════════════════════════════════════
//const API_URL = 'http://localhost:8000'; // Убедись, что порт совпадает с твоим

const API_URL = '/api'; 
let chatHistory = [];
let allSources = [];
let isStreaming = false;
let authToken = localStorage.getItem('academic_writer_token');
let currentUser = JSON.parse(localStorage.getItem('academic_writer_user') || 'null');

// ═══════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════
function escapeHtml(str) {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// ═══════════════════════════════════════════════════════════
// ТЕРМИНЫ
// ═══════════════════════════════════════════════════════════
let terms = JSON.parse(localStorage.getItem('academic_writer_terms') || '[]');

function showAddTermModal() {
    document.getElementById('add-term-modal').style.display = 'flex';
    document.getElementById('term-name').value = '';
    document.getElementById('term-definition').value = '';
    document.getElementById('term-name').focus();
}

function closeAddTermModal() {
    document.getElementById('add-term-modal').style.display = 'none';
}

function saveTerm() {
    const name = document.getElementById('term-name').value.trim();
    const definition = document.getElementById('term-definition').value.trim();
    
    if (!name || !definition) {
        alert('Пожалуйста, заполните оба поля');
        return;
    }
    
    terms.push({ name, definition });
    localStorage.setItem('academic_writer_terms', JSON.stringify(terms));
    renderTerms();
    closeAddTermModal();
}

function renderTerms() {
    const termsList = document.getElementById('terms-list');
    if (!termsList) return;
    
    termsList.innerHTML = '';
    terms.forEach((term, index) => {
        const termEl = document.createElement('div');
        termEl.className = 'term-item';
        termEl.innerHTML = `
            <div class="term-header">
                <strong>${escapeHtml(term.name)}</strong>
                <button class="term-delete" onclick="deleteTerm(${index})">×</button>
            </div>
            <div class="term-definition">${escapeHtml(term.definition)}</div>
        `;
        termsList.appendChild(termEl);
    });
}

function deleteTerm(index) {
    terms.splice(index, 1);
    localStorage.setItem('academic_writer_terms', JSON.stringify(terms));
    renderTerms();
}

// ═══════════════════════════════════════════════════════════
// АВТОРИЗАЦИЯ
// ═══════════════════════════════════════════════════════════
function initAuth() {
    const modal = document.getElementById('auth-modal');
    const logoutBtn = document.getElementById('logout-btn');
    
    
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.getElementById('login-form').style.display = target === 'login' ? 'block' : 'none';
            document.getElementById('register-form').style.display = target === 'register' ? 'block' : 'none';
            document.querySelectorAll('.auth-error').forEach(e => e.classList.remove('show'));
        });
    });
    
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    if (authToken) {
        refreshCurrentUser(); // ✅ Запрашиваем актуальные лимиты с сервера
    } else {
        if (modal) modal.style.display = 'flex';

        if (logoutBtn) logoutBtn.style.display = 'none';
    }
}

// ✅ Обновляет текущего пользователя и его лимиты с сервера при загрузке страницы.
// Ранее requests_used брался только из localStorage и мог быть устаревшим.
async function refreshCurrentUser() {
    const modal = document.getElementById('auth-modal');
    const logoutBtn = document.getElementById('logout-btn');
    try {
        const res = await fetch(`${API_URL}/auth/me`, { headers: getAuthHeaders() });
        // 401/403 — сессия недействительна: выходим, не показывая внутренних ошибок.
        if (res.status === 401 || res.status === 403) {
            clearSession();
            return;
        }
        if (!res.ok) {
            // Временная ошибка (сеть/сервер): не показываем внутренние детали,
            // оставляем данные из localStorage как fallback.
            if (modal) modal.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'block';
            updateUsageIndicator();
            return;
        }
        const data = await res.json();
        currentUser = {
            id: data.user_id,
            subscription: data.subscription_type,
            email: data.email,
            requests_used: data.requests_used,
            requests_limit: data.requests_limit
        };
        localStorage.setItem('academic_writer_user', JSON.stringify(currentUser));
        if (modal) modal.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'block';
        updateUsageIndicator();
    } catch (err) {
        // Сеть/временная ошибка: не показываем внутренние детали.
        if (modal) modal.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'block';
        updateUsageIndicator();
    }
}

function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return headers;
}

function showError(formId, message) {
    const errorDiv = document.getElementById(`${formId}-error`);
    if (errorDiv) { errorDiv.textContent = message; errorDiv.classList.add('show'); }
}

async function handleLogin(e) {
    e.preventDefault();
    document.querySelectorAll('.auth-error').forEach(el => el.classList.remove('show'));
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Входим...';
    
    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Ошибка входа'); }
        const data = await res.json();
        authToken = data.access_token;
        // ✅ СОХРАНЯЕМ ЛИМИТЫ
        currentUser = { 
            id: data.user_id, 
            subscription: data.subscription_type, 
            email,
            requests_used: data.requests_used,
            requests_limit: data.requests_limit
        };
        localStorage.setItem('academic_writer_token', authToken);
        localStorage.setItem('academic_writer_user', JSON.stringify(currentUser));
        document.getElementById('auth-modal').style.display = 'none';
        
        
        document.getElementById('logout-btn').style.display = 'block';
        updateUsageIndicator(); // ✅ Обновляем индикатор
    } catch (err) { showError('login', err.message); }
    finally { btn.disabled = false; btn.textContent = 'Войти'; }
}

async function handleRegister(e) {
    e.preventDefault();
    document.querySelectorAll('.auth-error').forEach(el => el.classList.remove('show'));
    const email = document.getElementById('register-email').value.trim();
    const p1 = document.getElementById('register-password').value;
    const p2 = document.getElementById('register-password2').value;
    if (p1 !== p2) { showError('register', 'Пароли не совпадают'); return; }
    
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Регистрируем...';
    
    try {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: p1 })
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Ошибка'); }
        alert('Регистрация успешна! Теперь войдите.');
        document.querySelector('[data-tab="login"]').click();
        document.getElementById('login-email').value = email;
    } catch (err) { showError('register', err.message); }
    finally { btn.disabled = false; btn.textContent = 'Создать аккаунт'; }
}

function clearSession() {
    authToken = null; currentUser = null;
    localStorage.removeItem('academic_writer_token');
    localStorage.removeItem('academic_writer_user');
    // User-scoped данные: удаляем, чтобы не попали следующему пользователю.
    localStorage.removeItem('academic_writer_chat_history');
    localStorage.removeItem('academic_writer_content');
    localStorage.removeItem('academic_writer_terms');
    // Сброс содержимого Quill-редактора в памяти (иначе User B увидит текст User A).
    if (typeof quill !== 'undefined' && quill) {
        quill.setContents([]);
    }
    // Сброс in-memory состояния.
    chatHistory = [];
    allSources = [];
    terms = [];
    // Очистка DOM: чат и список терминов (без пользовательских данных).
    const messagesDiv = document.getElementById('chat-messages');
    if (messagesDiv) {
        messagesDiv.innerHTML = `<div class="chat-message bot">Здравствуйте! Я — Наталья Петровна Копцева. Чем могу помочь?</div>`;
    }
    renderTerms();
    const modal = document.getElementById('auth-modal');
    const logoutBtn = document.getElementById('logout-btn');
    if (modal) modal.style.display = 'flex';
    if (logoutBtn) logoutBtn.style.display = 'none';
}

function logout() {
    if (!confirm('Выйти из системы?')) return;
    clearSession();
}

// ═══════════════════════════════════════════════════════════
// ЧАТ
// ═══════════════════════════════════════════════════════════
function initChat() {
    const savedChat = localStorage.getItem('academic_writer_chat_history');
    if (savedChat) {
        chatHistory = JSON.parse(savedChat);
        chatHistory.forEach(msg => renderChatMessage(msg.role, msg.text));
    }
}

function renderChatMessage(role, text) {
    const messagesDiv = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    messageDiv.textContent = text;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function sendChat() {
    if (!authToken) {
        document.getElementById('auth-modal').style.display = 'flex';
        return;
    }
    const input = document.getElementById('chat-input');
    const question = input.value.trim();
    if (!question || isStreaming) return;

    renderChatMessage('user', question);
    chatHistory.push({ role: 'user', text: question });
    input.value = '';
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true; isStreaming = true;

    const answerDiv = document.createElement('div');
    answerDiv.className = 'chat-message bot';
    answerDiv.innerHTML = '<em>Думаю...</em>';
    document.getElementById('chat-messages').appendChild(answerDiv);

    let fullAnswer = ''; let sourcesEl = null;

    try {
        const historyToSend = chatHistory.slice(-6).map(msg => ({
            role: msg.role === 'bot' ? 'assistant' : 'user', content: msg.text
        }));

        // Получаем текущий ГОСТ для передачи в запрос к ИИ
        const currentGost = getCurrentGostName();
        const systemPrompt = `Ты — академический ассистент. Текущий активный стандарт оформления документа: ${currentGost}. Учитывай это при генерации или редактировании текста.`;

        const response = await fetch(`${API_URL}/ask-stream`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({
                question: question, match_count: 5, match_threshold: 0.2,
                dual_language: false, history: historyToSend,
                system_prompt: systemPrompt
            })
        });

        if (response.status === 401) {
            alert('Сессия истекла. Войдите снова.');
            clearSession();
            answerDiv.innerHTML = '<span style="color: red;">Требуется авторизация.</span>';
            sendBtn.disabled = false; isStreaming = false; return;
        }
        if (response.status === 403) {
            const errData = await response.json();
            alert(errData.detail || 'Лимит исчерпан.');
            answerDiv.innerHTML = '<span style="color: red;">Лимит запросов исчерпан.</span>';
            sendBtn.disabled = false; isStreaming = false; return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ''; answerDiv.innerHTML = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n'); buffer = lines.pop();
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.type === 'sources') {
                            if (data.sources) data.sources.forEach(s => { if (!allSources.some(x => x.title === s.title)) allSources.push(s); });
                            sourcesEl = buildAnswerSources(data);
                            renderAssistantAnswer(answerDiv, fullAnswer, sourcesEl);
                        } else if (data.type === 'answer') {
                            fullAnswer += data.content;
                            renderAssistantAnswer(answerDiv, fullAnswer, sourcesEl);
                            document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
                        } else if (data.type === 'done') {
                            renderAssistantAnswer(answerDiv, fullAnswer, sourcesEl);
                            chatHistory.push({ role: 'bot', text: fullAnswer });
                            localStorage.setItem('academic_writer_chat_history', JSON.stringify(chatHistory));
                            incrementLocalCounter(); // ✅ Увеличиваем счётчик после успешного ответа
                        } else if (data.type === 'error') {
                            renderAssistantError(answerDiv, data.content);
                        }
                    } catch (e) { console.error('Parse error:', e); }
                }
            }
        }
    } catch (error) {
        renderAssistantError(answerDiv, error.message);
    } finally {
        sendBtn.disabled = false; isStreaming = false;
        document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    }
}

function clearChatHistory() {
    if(confirm('Очистить историю?')) {
        chatHistory = []; allSources = [];
        localStorage.removeItem('academic_writer_chat_history');
        document.getElementById('chat-messages').innerHTML = `<div class="chat-message bot">Здравствуйте! Я — Наталья Петровна Копцева. Чем могу помочь?</div>`;
    }
}

function insertCitation(title, text) {
    if (typeof quill !== 'undefined') {
        let range = quill.getSelection();
        let index = range ? range.index : quill.getLength();
        quill.insertText(index, `\n[${title}]\n«${text}»\n`, 'user');
        quill.setSelection(index + text.length + 10);
        quill.focus();
    }
}

// Переключатель блока источников в ответе ассистента: разворачивает/сворачивает список.
function toggleAnswerSources(btn) {
    const wrap = btn.parentElement; // .answer-sources
    if (!wrap) return;
    const body = wrap.querySelector('.answer-sources-body');
    const icon = btn.querySelector('.answer-sources-icon');
    if (!body) return;
    const expanded = body.classList.toggle('expanded');
    if (icon) icon.textContent = expanded ? '▼' : '▶';
}

// Безопасное построение блока источников ответа ассистента через DOM API.
// Заголовок и текст чанка выводятся как текст (textContent), кнопка «Вставить»
// использует addEventListener + замыкание вместо inline-onclick.
function buildAnswerSources(data) {
    if (!data.sources || data.sources.length === 0) return null;

    const wrap = document.createElement('div');
    wrap.className = 'answer-sources';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'answer-sources-toggle';
    const icon = document.createElement('span');
    icon.className = 'answer-sources-icon';
    icon.textContent = '▶';
    toggle.appendChild(icon);
    toggle.appendChild(document.createTextNode(' 📚 Источники (' + data.sources.length + ')'));
    toggle.addEventListener('click', function () { toggleAnswerSources(toggle); });
    wrap.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'answer-sources-body';

    data.sources.forEach((source, index) => {
        const sim = (data.similarity_scores[index] * 100).toFixed(1);
        const isOn = source.is_online || source.title.includes('🌐');
        const doi = source.article_url ? `https://doi.org/${source.article_url}` : '';

        const item = document.createElement('div');
        item.className = 'source-item';
        if (isOn) item.style.borderLeftColor = '#4caf50';

        const btn = document.createElement('button');
        btn.className = 'insert-cite-btn';
        btn.textContent = ' Вставить';
        const citeTitle = source.title.replace(/\n/g, ' ');
        const citeText = source.chunk_text.substring(0, 300).replace(/\n/g, ' ');
        btn.addEventListener('click', function () { insertCitation(citeTitle, citeText); });
        item.appendChild(btn);

        const strong = document.createElement('strong');
        strong.textContent = `[${index + 1}] ${source.title}`;
        item.appendChild(strong);

        if (isOn) {
            const online = document.createElement('span');
            online.style.cssText = 'background:#e8f5e9;color:#2e7d32;padding:2px 6px;border-radius:4px;font-size:10px;';
            online.textContent = 'ONLINE';
            item.appendChild(online);
        } else {
            const simSpan = document.createElement('span');
            simSpan.style.cssText = 'color:#999;font-size:11px;';
            simSpan.textContent = `(${sim}%)`;
            item.appendChild(simSpan);
        }

        item.appendChild(document.createElement('br'));
        const em = document.createElement('em');
        em.textContent = source.chunk_text.substring(0, 200) + '...';
        item.appendChild(em);
        item.appendChild(document.createElement('br'));

        if (isOn && doi) {
            const a = document.createElement('a');
            a.href = doi;
            a.target = '_blank';
            a.style.cssText = 'color:#667eea;font-size:12px;';
            a.textContent = ' Открыть (DOI)';
            item.appendChild(a);
        }

        body.appendChild(item);
    });

    wrap.appendChild(body);
    return wrap;
}

// Отрисовка ответа ассистента: текст выводится через textContent (переносы строк
// сохраняются через white-space: pre-wrap), блок источников — отдельный DOM-узел.
function renderAssistantAnswer(answerDiv, text, sourcesEl) {
    answerDiv.textContent = '';
    if (text) {
        const textEl = document.createElement('div');
        textEl.className = 'assistant-answer-text';
        textEl.style.whiteSpace = 'pre-wrap';
        textEl.textContent = text;
        answerDiv.appendChild(textEl);
    }
    if (sourcesEl) answerDiv.appendChild(sourcesEl);
}

// Безопасная отрисовка ошибки: текст выводится как текст, а не как HTML.
function renderAssistantError(answerDiv, message) {
    answerDiv.textContent = '';
    const span = document.createElement('span');
    span.style.color = 'red';
    span.textContent = 'Ошибка: ' + String(message);
    answerDiv.appendChild(span);
}
// ═══════════════════════════════════════════════════════════
// ИНДИКАТОР ЛИМИТОВ
// ═══════════════════════════════════════════════════════════
function updateUsageIndicator() {
    const indicator = document.getElementById('usage-indicator');
    if (!indicator || !currentUser) return;
    
    const used = currentUser.requests_used || 0;
    const limit = currentUser.requests_limit || 0;
    const sub = currentUser.subscription || 'free';
    
    indicator.textContent = `📊 ${used} / ${limit} (${sub.toUpperCase()})`;
    
    // Меняем цвет, если лимит близок
    if (limit > 0 && used >= limit * 0.8) {
        indicator.style.color = '#f44336'; // Красный, если использовано 80%+
    } else if (limit > 0 && used >= limit * 0.5) {
        indicator.style.color = '#ff9800'; // Оранжевый, если 50%+
    } else {
        indicator.style.color = '#4caf50'; // Зеленый
    }
}

function incrementLocalCounter() {
    if (currentUser) {
        currentUser.requests_used = (currentUser.requests_used || 0) + 1;
        localStorage.setItem('academic_writer_user', JSON.stringify(currentUser));
        updateUsageIndicator();
    }
}

// Запуск при загрузке
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initChat();
    renderTerms();
    
    // Инициализация вкладок
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // Активируем первую вкладку по умолчанию
    if (tabButtons.length > 0 && tabContents.length > 0) {
        tabButtons[0].click();
    }
    
    tabButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            this.classList.add('active');
            const targetElement = document.getElementById('tab-' + targetTab);
            if (targetElement) {
                targetElement.classList.add('active');
            }

            // Загружаем список источников при открытии вкладки
            if (targetTab === 'sources') {
                loadDocuments();
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════
// DROPDOWN МЕНЮ ДЛЯ ЭКСПОРТА И ГОСТ
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
    // Export dropdown
    const exportBtn = document.getElementById('export-dropdown-btn');
    const exportDropdown = document.getElementById('export-dropdown');
    
    if (exportBtn && exportDropdown) {
        exportBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            
            // Устанавливаем позицию dropdown
            const rect = exportBtn.getBoundingClientRect();
            exportDropdown.style.top = rect.top + 'px';
            exportDropdown.style.left = (rect.right + 8) + 'px';
            
            exportDropdown.classList.toggle('show');
        });
        
        document.addEventListener('click', function() {
            exportDropdown.classList.remove('show');
        });
        
        exportDropdown.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
    
    // Обработка dropdown для ГОСТ
    const gostBtn = document.getElementById('gost-dropdown-btn');
    const gostDropdown = document.getElementById('gost-dropdown');
    
    if (gostBtn && gostDropdown) {
        gostBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            
            // Устанавливаем позицию dropdown
            const rect = gostBtn.getBoundingClientRect();
            gostDropdown.style.top = rect.top + 'px';
            gostDropdown.style.left = (rect.right + 8) + 'px';
            
            gostDropdown.classList.toggle('show');
        });
        
        document.addEventListener('click', function() {
            gostDropdown.classList.remove('show');
        });
        
        gostDropdown.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
});

// ═══════════════════════════════════════════════════════════
// ПРИМЕНЕНИЕ ФОРМАТА ГОСТ
// ═══════════════════════════════════════════════════════════
function applyGostFormat(format) {
    // 1. Сохраняем в localStorage
    localStorage.setItem('active_gost', format);
    
    const gostSelect = document.getElementById('gost-select');
    if (gostSelect) {
        gostSelect.value = format;
    }
    
    // 2. Применяем CSS-класс к редактору
    const editorContainer = document.getElementById('editor-container');
    if (editorContainer) {
        // Удаляем все старые классы gost-*
        editorContainer.classList.remove('gost-report', 'gost-thesis', 'gost-article', 'gost-ord', 'gost-free');
        // Добавляем новый
        editorContainer.classList.add(format);
    }

    // 3. Обновляем визуальное выделение в dropdown (галочка)
    document.querySelectorAll('.gost-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-format') === format) {
            btn.classList.add('active');
        }
    });

    // 4. Закрываем dropdown
    const gostDropdown = document.getElementById('gost-dropdown');
    if (gostDropdown) gostDropdown.classList.remove('show');

    // 5. Обновляем контекст для ИИ
    updateAIContext(format);
}

// Функция для получения названия текущего ГОСТа
function getCurrentGostName() {
    const format = localStorage.getItem('active_gost') || 'gost-report';
    const names = {
        'gost-report': 'ГОСТ 7.32-2017 (Отчет о НИР)',
        'gost-thesis': 'ГОСТ 7.1-2003 (Диссертация)',
        'gost-article': 'Статья ВАК',
        'gost-ord': 'ГОСТ Р 7.0.97-2016 (ОРД)',
        'gost-free': 'Свободное форматирование'
    };
    return names[format];
}

// Функция для передачи контекста ИИ
function updateAIContext(format) {
    window.currentGostContext = `Оформи ответ строго по ${getCurrentGostName()}`;
    console.log('AI Context updated to:', getCurrentGostName());
}

// Функция инициализации при загрузке страницы — объединяем с обработкой dropdown
document.addEventListener('DOMContentLoaded', function() {
    // Инициализация ГОСТ
    const savedGost = localStorage.getItem('active_gost') || 'gost-report';
    applyGostFormat(savedGost);
    
    // ═══════════════════════════════════════════════════════════
    // ЗАГРУЗКА PDF (DRAG-AND-DROP)
    // ═══════════════════════════════════════════════════════════
    const dropZone = document.getElementById('drop-zone');
    const pdfInput = document.getElementById('pdf-input');
    
    if (dropZone && pdfInput) {
        // Drag over
        dropZone.addEventListener('dragover', handleDragOver);
        
        // Drag leave
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        
        // Drop
        dropZone.addEventListener('drop', handleDrop);
        
        // Click on drop zone triggers file input
        dropZone.addEventListener('click', () => pdfInput.click());
        
        // File input change
        pdfInput.addEventListener('change', handleFileSelect);
    }
});

// ═══════════════════════════════════════════════════════════
// ФУНКЦИИ ЗАГРУЗКИ PDF
// ═══════════════════════════════════════════════════════════
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        dropZone.classList.add('dragover');
    }
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        dropZone.classList.remove('dragover');
    }
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        if (file.type === 'application/pdf') {
            uploadPdf(file);
        } else {
            alert('Пожалуйста, выберите PDF файл');
        }
    }
}

function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        const file = files[0];
        if (file.type === 'application/pdf') {
            uploadPdf(file);
        } else {
            alert('Пожалуйста, выберите PDF файл');
            e.target.value = '';
        }
    }
}

async function uploadPdf(file) {
    if (!authToken) {
        alert('Требуется авторизация для загрузки файлов');
        document.getElementById('auth-modal').style.display = 'flex';
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    const sourcesList = document.getElementById('sources-list');
    if (sourcesList) {
        sourcesList.innerHTML = '<div class="chat-message bot">Загрузка PDF...</div>';
    }
    
    try {
        // For FormData, do NOT set Content-Type manually.
        // Browser will set multipart/form-data with correct boundary.
        // If we force application/json, backend sees empty body → 422.
        const headers = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        
        const response = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            headers: headers,
            body: formData
        });
        
        if (response.status === 401) {
            alert('Сессия истекла. Войдите снова.');
            clearSession();
            return;
        }
        
        if (!response.ok) {
            throw new Error(`Ошибка загрузки: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Backend returns HTTP 200 + {success: false, error: "..."} on processing errors.
        // Without this check, frontend shows "success" even when parsing fails.
        if (!result.success) {
            throw new Error(result.error || 'Сервер не смог обработать файл');
        }
        
        // Очищаем зону загрузки
        const dropZone = document.getElementById('drop-zone');
        if (dropZone) {
            dropZone.style.display = 'none';
        }
        
        // Показываем загруженный файл в списке источников
        if (sourcesList) {
            sourcesList.innerHTML = '';
            const sourceEl = document.createElement('div');
            sourceEl.className = 'source-item';
            sourceEl.style.borderLeftColor = '#4caf50';
            sourceEl.innerHTML = `
                <strong>[1] ${escapeHtml(file.name)}</strong><br>
                <em>Файл успешно загружен и обработан</em>
            `;
            sourcesList.appendChild(sourceEl);
        }
        
        alert(`Файл "${file.name}" успешно загружен!`);

        // Обновляем список источников
        loadDocuments();

    } catch (error) {
        console.error('Ошибка загрузки PDF:', error);
        if (sourcesList) {
            sourcesList.innerHTML = `<div class="chat-message bot" style="color: red;">Ошибка: ${error.message}</div>`;
        }
        alert('Ошибка при загрузке файла');
    }
}

// ═══════════════════════════════════════════════════════════
// УПРАВЛЕНИЕ ИСТОЧНИКАМИ ("Мои источники")
// ═══════════════════════════════════════════════════════════

async function loadDocuments() {
    if (!authToken) return;

    const sourcesList = document.getElementById('sources-list');
    if (!sourcesList) return;

    try {
        const res = await fetch(`${API_URL}/documents`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401) {
            clearSession();
            return;
        }

        if (!res.ok) {
            sourcesList.innerHTML = '<div style="color:#999;font-size:13px;">Нет загруженных источников</div>';
            return;
        }

        const data = await res.json();
        const docs = data.documents || [];

        if (docs.length === 0) {
            sourcesList.innerHTML = '<div style="color:#999;font-size:13px;">Нет загруженных источников</div>';
            return;
        }

        // Источники — только список. upload-area остаётся статичной в academic-writer.html,
        // поэтому не копируем её сюда и не перепривязываем обработчики.
        const section = document.createElement('div');
        section.className = 'my-sources-section';
        const heading = document.createElement('h4');
        heading.style.cssText = 'margin:10px 0;font-size:14px;color:var(--text-main);';
        heading.textContent = '📂 Мои источники';
        section.appendChild(heading);

        docs.forEach(doc => {
            const item = document.createElement('div');
            item.className = 'doc-item';

            const info = document.createElement('div');
            info.className = 'doc-info';

            const title = document.createElement('strong');
            title.textContent = doc.title;
            info.appendChild(title);

            const chunks = document.createElement('span');
            chunks.className = 'doc-chunks';
            chunks.textContent = `${doc.chunks} чанков`;
            info.appendChild(chunks);

            item.appendChild(info);

            const btn = document.createElement('button');
            btn.className = 'doc-delete-btn';
            btn.title = 'Удалить';
            btn.textContent = '🗑 Удалить';
            btn.addEventListener('click', function () { deleteDocument(doc.article_url); });
            item.appendChild(btn);

            section.appendChild(item);
        });

        sourcesList.innerHTML = '';
        sourcesList.appendChild(section);
    } catch (e) {
        console.error('Ошибка загрузки документов:', e);
        sourcesList.innerHTML = '<div style="color:#e74c3c;font-size:13px;">Ошибка загрузки списка</div>';
    }
}

async function deleteDocument(articleUrl) {
    if (!confirm('Удалить этот документ и все его чанки?')) return;
    if (!authToken) return;

    try {
        const res = await fetch(`${API_URL}/documents?article_url=${encodeURIComponent(articleUrl)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (res.status === 401) {
            clearSession();
            return;
        }

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Ошибка удаления');
        }

        const data = await res.json();
        alert(`Удалено чанков: ${data.deleted_chunks}`);
        loadDocuments(); // Обновляем список
    } catch (e) {
        alert(`Ошибка: ${e.message}`);
    }
}