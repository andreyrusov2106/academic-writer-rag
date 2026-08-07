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
                <strong>${term.name}</strong>
                <button class="term-delete" onclick="deleteTerm(${index})">×</button>
            </div>
            <div class="term-definition">${term.definition}</div>
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
    
    if (authToken && currentUser) {
        if (modal) modal.style.display = 'none';
        
        if (logoutBtn) logoutBtn.style.display = 'block';
        updateUsageIndicator(); // ✅ Показываем лимиты при загрузке
    } else {
        if (modal) modal.style.display = 'flex';
        
        if (logoutBtn) logoutBtn.style.display = 'none';
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

function logout() {
    if (!confirm('Выйти из системы?')) return;
    authToken = null; currentUser = null;
    localStorage.removeItem('academic_writer_token');
    localStorage.removeItem('academic_writer_user');
    document.getElementById('auth-modal').style.display = 'flex';
    
    
    document.getElementById('logout-btn').style.display = 'none';
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

    let fullAnswer = ''; let sourcesHtml = '';

    try {
        const historyToSend = chatHistory.slice(-6).map(msg => ({
            role: msg.role === 'bot' ? 'assistant' : 'user', content: msg.text
        }));

        const response = await fetch(`${API_URL}/ask-stream`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({
                question: question, match_count: 5, match_threshold: 0.2,
                dual_language: false, history: historyToSend
            })
        });

        if (response.status === 401) {
            alert('Сессия истекла. Войдите снова.');
            localStorage.removeItem('academic_writer_token');
            localStorage.removeItem('academic_writer_user');
            authToken = null;
            document.getElementById('auth-modal').style.display = 'flex';
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
                            sourcesHtml = '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #ccc;font-size:12px;"><strong>📚 Источники:</strong><br>';
                            data.sources.forEach((source, index) => {
                                const sim = (data.similarity_scores[index] * 100).toFixed(1);
                                const escT = source.title.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
                                const escTx = source.chunk_text.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ').substring(0, 300);
                                const isOn = source.is_online || source.title.includes('🌐');
                                const doi = source.article_url ? `https://doi.org/${source.article_url}` : '';
                                sourcesHtml += `<div class="source-item" style="${isOn ? 'border-left-color: #4caf50;' : ''}">`;
                                sourcesHtml += `<button class="insert-cite-btn" onclick="insertCitation('${escT}', '${escTx}')"> Вставить</button>`;
                                sourcesHtml += `<strong>[${index + 1}] ${source.title}</strong>`;
                                sourcesHtml += isOn ? ` <span style="background:#e8f5e9;color:#2e7d32;padding:2px 6px;border-radius:4px;font-size:10px;">ONLINE</span>` : ` <span style="color:#999;font-size:11px;">(${sim}%)</span>`;
                                sourcesHtml += `<br><em>${source.chunk_text.substring(0, 200)}...</em><br>`;
                                if (isOn && doi) sourcesHtml += `<a href="${doi}" target="_blank" style="color:#667eea;font-size:12px;"> Открыть (DOI)</a>`;
                                sourcesHtml += `</div>`;
                            });
                            sourcesHtml += '</div>';
                        } else if (data.type === 'answer') {
                            fullAnswer += data.content;
                            answerDiv.innerHTML = fullAnswer.replace(/\n/g, '<br>') + sourcesHtml;
                            document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
                        } else if (data.type === 'done') {
                            answerDiv.innerHTML = fullAnswer.replace(/\n/g, '<br>') + sourcesHtml;
                            chatHistory.push({ role: 'bot', text: fullAnswer });
                            localStorage.setItem('academic_writer_chat_history', JSON.stringify(chatHistory));
                            incrementLocalCounter(); // ✅ Увеличиваем счётчик после успешного ответа
                        } else if (data.type === 'error') {
                            answerDiv.innerHTML = `<span style="color: red;">Ошибка: ${data.content}</span>`;
                        }
                    } catch (e) { console.error('Parse error:', e); }
                }
            }
        }
    } catch (error) {
        answerDiv.innerHTML = `<span style="color: red;">Ошибка: ${error.message}</span>`;
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
    
    // Инициализация темы
    const savedTheme = localStorage.getItem('theme') || 'light';
    const themeIcon = document.querySelector('.theme-icon');
    if (themeIcon) {
        themeIcon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    }
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
    }
    
    // Переключатель темы (в хедере и в левой панели)
    const themeBtn = document.getElementById('theme-toggle-btn');
    const themeBtnLeft = document.getElementById('theme-toggle-btn-left');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }
    if (themeBtnLeft) {
        themeBtnLeft.addEventListener('click', toggleTheme);
    }
    
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
        });
    });
});

// ═══════════════════════════════════════════════════════════
// ПЕРЕКЛЮЧЕНИЕ ТЕМЫ
// ═══════════════════════════════════════════════════════════
function toggleTheme() {
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    
    // Обновляем иконку в хедере
    const themeIcon = document.querySelector('.theme-icon');
    if (themeIcon) {
        themeIcon.textContent = isDark ? '☀️' : '🌙';
    }
    
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

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
            exportDropdown.classList.toggle('show');
        });
        
        document.addEventListener('click', function() {
            exportDropdown.classList.remove('show');
        });
        
        exportDropdown.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }
    
    // GOST dropdown
    const gostBtn = document.getElementById('gost-dropdown-btn');
    const gostDropdown = document.getElementById('gost-dropdown');
    
    if (gostBtn && gostDropdown) {
        gostBtn.addEventListener('click', function(e) {
            e.stopPropagation();
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
    const gostSelect = document.getElementById('gost-select');
    if (gostSelect) {
        gostSelect.value = format;
        applyGost();
    }
    const gostDropdown = document.getElementById('gost-dropdown');
    if (gostDropdown) {
        gostDropdown.classList.remove('show');
    }
}

// ═══════════════════════════════════════════════════════════
// ОБРАБОТКА DROPDOWN ДЛЯ ГОСТ И ЭКСПОРТА
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
    const gostBtn = document.getElementById('gost-dropdown-btn');
    const gostDropdown = document.getElementById('gost-dropdown');
    
    if (gostBtn && gostDropdown) {
        gostBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            gostDropdown.classList.toggle('show');
        });
        
        document.addEventListener('click', function() {
            gostDropdown.classList.remove('show');
        });
    }
    
    // Обработка dropdown для экспорта
    const exportBtn = document.getElementById('export-dropdown-btn');
    const exportDropdown = document.getElementById('export-dropdown');
    
    if (exportBtn && exportDropdown) {
        exportBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            exportDropdown.classList.toggle('show');
        });
        
        document.addEventListener('click', function() {
            exportDropdown.classList.remove('show');
        });
    }
});