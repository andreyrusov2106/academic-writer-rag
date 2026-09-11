// ═══════════════════════════════════════════════════════════
// АДМИН-ПАНЕЛЬ (admin.html)
// ═══════════════════════════════════════════════════════════
// Использует существующую систему авторизации проекта:
//   - JWT хранится в localStorage['academic_writer_token'];
//   - API_URL совпадает с остальным фронтендом ('/api');
//   - is_admin НЕ читается из localStorage — признак администратора
//     определяется ТОЛЬКО ответом сервера на GET /api/admin/users
//     (200 — администратор, 403 — доступ запрещён, 401 — не авторизован).

const API_URL = '/api';
const TOKEN_KEY = 'academic_writer_token';
const USER_KEY = 'academic_writer_user';

// Кэш данных, полученных с сервера. Используется для заполнения
// селекторов доступа и для подписей в списке статей.
let usersCache = [];        // [{id, email, specialty_code, is_admin}]
let articlesCache = [];     // [{article_url, title, chunks, allowed_user_ids, allowed_specialty_codes, global}]
let editingArticleUrl = null; // article_url, редактируемый в модальном окне

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('academic_writer_chat_history');
    localStorage.removeItem('academic_writer_content');
    localStorage.removeItem('academic_writer_terms');
}

function redirectToLogin() {
    window.location.href = '/academic-writer.html';
}

// ─────────────────────────────────────────────────────────────
// Блок текущего пользователя (только для отображения, email)
// ─────────────────────────────────────────────────────────────
function renderCurrentUser() {
    const el = document.getElementById('current-user');
    if (!el) return;
    try {
        const stored = localStorage.getItem(USER_KEY);
        const user = stored ? JSON.parse(stored) : null;
        el.textContent = user && user.email ? user.email : 'Администратор';
    } catch (e) {
        el.textContent = 'Администратор';
    }
}

function logout() {
    if (!confirm('Выйти из системы?')) return;
    clearToken();
    redirectToLogin();
}

// ─────────────────────────────────────────────────────────────
// Отображение списка пользователей
// ─────────────────────────────────────────────────────────────
function renderUsers(users) {
    const listEl = document.getElementById('users-list');
    if (!listEl) return;

    if (!Array.isArray(users) || users.length === 0) {
        listEl.innerHTML = '<p class="empty">Пользователи не найдены</p>';
        return;
    }

    const rows = users.map(u => `
        <tr data-user-id="${escapeHtml(u.id)}">
            <td>${escapeHtml(u.id)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>
                <input type="checkbox" class="admin-checkbox" ${u.is_admin ? 'checked' : ''}
                       title="${u.is_admin ? 'админ' : 'пользователь'}">
            </td>
            <td>
                <input type="text" class="admin-input specialty-input"
                       value="${escapeHtml(u.specialty_code ?? '')}" placeholder="—">
            </td>
            <td>
                <button type="button" class="btn-primary save-btn">Сохранить</button>
                <span class="row-status"></span>
            </td>
        </tr>
    `).join('');

    listEl.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Email</th>
                    <th>Админ</th>
                    <th>Специальность</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = 'row-status' + (kind ? ' ' + kind : '');
}

// ─────────────────────────────────────────────────────────────
// Сохранение изменений пользователя (PUT /api/admin/users/{id})
// ─────────────────────────────────────────────────────────────
async function saveUser(userId, row) {
    const checkbox = row.querySelector('.admin-checkbox');
    const specialtyInput = row.querySelector('.specialty-input');
    const statusEl = row.querySelector('.row-status');
    const btn = row.querySelector('.save-btn');
    if (!checkbox || !specialtyInput || !btn) return;

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
        redirectToLogin();
        return;
    }

    const body = {
        is_admin: checkbox.checked,
        specialty_code: specialtyInput.value === '' ? null : specialtyInput.value
    };

    setStatus(statusEl, 'Сохранение…', '');
    btn.disabled = true;

    let res;
    try {
        res = await fetch(`${API_URL}/admin/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });
    } catch (e) {
        setStatus(statusEl, 'Ошибка сети', 'err');
        btn.disabled = false;
        return;
    }

    if (res.status === 401) {
        clearToken();
        redirectToLogin();
        return;
    }

    let data;
    try {
        data = await res.json();
    } catch (e) {
        data = null;
    }

    if (res.status === 403) {
        setStatus(statusEl, 'Доступ запрещён', 'err');
        btn.disabled = false;
        return;
    }

    if (!res.ok) {
        const msg = data && data.detail ? data.detail : `Ошибка (${res.status})`;
        setStatus(statusEl, msg, 'err');
        btn.disabled = false;
        return;
    }

    // Обновляем строку актуальными данными из ответа сервера (не перезагружаем страницу).
    checkbox.checked = !!data.is_admin;
    checkbox.title = data.is_admin ? 'админ' : 'пользователь';
    specialtyInput.value = data.specialty_code ?? '';
    setStatus(statusEl, 'Сохранено', 'ok');
    btn.disabled = false;
}

function showAccessDenied(message = 'Доступ запрещён') {
    const listEl = document.getElementById('users-list');
    if (listEl) {
        listEl.innerHTML = `<p class="access-denied">${escapeHtml(message)}</p>`;
    }
}

// ─────────────────────────────────────────────────────────────
// Загрузка списка пользователей
// ─────────────────────────────────────────────────────────────
async function loadUsers() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
        redirectToLogin();
        return;
    }

    let res;
    try {
        res = await fetch(`${API_URL}/admin/users`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (e) {
        showAccessDenied('Не удалось подключиться к серверу');
        return;
    }

    if (res.status === 401) {
        clearToken();
        redirectToLogin();
        return;
    }

    if (res.status === 403) {
        showAccessDenied('Доступ запрещён');
        return;
    }

    if (!res.ok) {
        showAccessDenied(`Ошибка сервера (${res.status})`);
        return;
    }

    let data;
    try {
        data = await res.json();
    } catch (e) {
        showAccessDenied('Некорректный ответ сервера');
        return;
    }

    usersCache = data.users || [];
    renderUsers(data.users);

    // Заполняем селекторы доступа (формы загрузки и модального редактора).
    populateUserSelect(document.getElementById('article-users'), []);
    populateUserSelect(document.getElementById('access-users'), []);
    populateSpecialtySelect(document.getElementById('article-specialties'), []);
    populateSpecialtySelect(document.getElementById('access-specialties'), []);
}

// ─────────────────────────────────────────────────────────────
// Хелперы для селекторов доступа
// ─────────────────────────────────────────────────────────────
function getSpecialtyCodes() {
    const codes = new Set();
    for (const u of usersCache) {
        if (u.specialty_code) codes.add(u.specialty_code);
    }
    return Array.from(codes).sort();
}

function populateUserSelect(selectEl, selectedUserIds) {
    if (!selectEl) return;
    const selected = new Set(selectedUserIds || []);
    selectEl.innerHTML = usersCache.map(u => {
        const id = u.id;
        return `<option value="${escapeHtml(id)}" ${selected.has(id) ? 'selected' : ''}>${escapeHtml(u.email)}</option>`;
    }).join('');
}

function populateSpecialtySelect(selectEl, selectedCodes) {
    if (!selectEl) return;
    const selected = new Set(selectedCodes || []);
    selectEl.innerHTML = getSpecialtyCodes().map(c =>
        `<option value="${escapeHtml(c)}" ${selected.has(c) ? 'selected' : ''}>${escapeHtml(c)}</option>`
    ).join('');
}

function readSelectedUserIds(selectEl) {
    return Array.from(selectEl ? selectEl.selectedOptions : [])
        .map(o => Number(o.value))
        .filter(n => Number.isInteger(n));
}

function readSelectedSpecialtyCodes(selectEl) {
    return Array.from(selectEl ? selectEl.selectedOptions : [])
        .map(o => o.value);
}

// ─────────────────────────────────────────────────────────────
// Список статей
// ─────────────────────────────────────────────────────────────
async function loadArticles() {
    const listEl = document.getElementById('articles-list');
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
        redirectToLogin();
        return;
    }

    let res;
    try {
        res = await fetch(`${API_URL}/admin/articles`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (e) {
        if (listEl) listEl.innerHTML = '<p class="empty">Не удалось подключиться к серверу</p>';
        return;
    }

    if (res.status === 401) {
        clearToken();
        redirectToLogin();
        return;
    }

    if (res.status === 403) {
        if (listEl) listEl.innerHTML = '<p class="access-denied">Доступ запрещён</p>';
        return;
    }

    if (!res.ok) {
        if (listEl) listEl.innerHTML = `<p class="empty">Ошибка сервера (${res.status})</p>`;
        return;
    }

    let data;
    try {
        data = await res.json();
    } catch (e) {
        if (listEl) listEl.innerHTML = '<p class="empty">Некорректный ответ сервера</p>';
        return;
    }

    articlesCache = data.articles || [];
    renderArticles(articlesCache);
}

function renderArticles(articles) {
    const listEl = document.getElementById('articles-list');
    if (!listEl) return;

    if (!Array.isArray(articles) || articles.length === 0) {
        listEl.innerHTML = '<p class="empty">Статьи не найдены</p>';
        return;
    }

    const emailById = new Map();
    for (const u of usersCache) emailById.set(u.id, u.email);

    const rows = articles.map(a => `
        <tr data-article-url="${escapeHtml(a.article_url)}">
            <td>${escapeHtml(a.title)}</td>
            <td>${escapeHtml(a.chunks)}</td>
            <td>${formatAccess(a, emailById)}</td>
            <td>
                <button type="button" class="btn btn-sm edit-access-btn">Доступ</button>
                <button type="button" class="btn-danger btn-sm delete-article-btn">Удалить</button>
            </td>
        </tr>
    `).join('');

    listEl.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Название</th>
                    <th>Чанки</th>
                    <th>Доступ</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function formatAccess(article, emailById) {
    if (article.global) {
        return '<span class="badge badge-user">Все пользователи</span>';
    }
    const userIds = article.allowed_user_ids || [];
    const codes = article.allowed_specialty_codes || [];
    const parts = [];
    if (userIds.length > 0) {
        const emails = userIds.map(id => emailById.get(id) || `#${id}`);
        parts.push(`<span class="access-tag" title="${escapeHtml(emails.join(', '))}">👤 ${userIds.length}</span>`);
    }
    if (codes.length > 0) {
        parts.push(`<span class="access-tag" title="${escapeHtml(codes.join(', '))}">🎓 ${codes.length}</span>`);
    }
    return parts.join(' ') || '<span class="badge badge-user">Все пользователи</span>';
}

// ─────────────────────────────────────────────────────────────
// Загрузка PDF (POST /api/admin/upload)
// ─────────────────────────────────────────────────────────────
async function uploadArticle() {
    const fileInput = document.getElementById('article-file');
    const usersSelect = document.getElementById('article-users');
    const specialtiesSelect = document.getElementById('article-specialties');
    const btn = document.getElementById('article-upload-btn');
    const statusEl = document.getElementById('upload-status');

    if (!fileInput || !btn) return;

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
        setStatus(statusEl, 'Выберите PDF-файл', 'err');
        return;
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        setStatus(statusEl, 'Можно загружать только PDF файлы', 'err');
        return;
    }

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
        redirectToLogin();
        return;
    }

    const userIds = readSelectedUserIds(usersSelect);
    const specialtyCodes = readSelectedSpecialtyCodes(specialtiesSelect);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('users', JSON.stringify(userIds));
    formData.append('specialties', JSON.stringify(specialtyCodes));

    setStatus(statusEl, 'Загрузка…', '');
    btn.disabled = true;

    let res;
    try {
        // Для FormData НЕ задаём Content-Type вручную — браузер подставит
        // multipart/form-data с корректным boundary.
        res = await fetch(`${API_URL}/admin/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
    } catch (e) {
        setStatus(statusEl, 'Ошибка сети', 'err');
        btn.disabled = false;
        return;
    }

    if (res.status === 401) {
        clearToken();
        redirectToLogin();
        return;
    }

    if (res.status === 403) {
        setStatus(statusEl, 'Доступ запрещён', 'err');
        btn.disabled = false;
        return;
    }

    let data;
    try {
        data = await res.json();
    } catch (e) {
        data = null;
    }

    if (!res.ok) {
        const msg = data && data.detail ? data.detail : `Ошибка (${res.status})`;
        setStatus(statusEl, msg, 'err');
        btn.disabled = false;
        return;
    }

    // Бэкенд возвращает HTTP 200 + {success: false, error} при ошибках обработки.
    if (!data || data.success !== true) {
        const msg = data && data.error ? data.error : 'Сервер не смог обработать файл';
        setStatus(statusEl, msg, 'err');
        btn.disabled = false;
        return;
    }

    // Успех: очищаем форму и обновляем список.
    fileInput.value = '';
    if (usersSelect) { for (const o of usersSelect.options) o.selected = false; }
    if (specialtiesSelect) { for (const o of specialtiesSelect.options) o.selected = false; }
    setStatus(statusEl, 'Статья загружена', 'ok');
    btn.disabled = false;
    await loadArticles();
}

// ─────────────────────────────────────────────────────────────
// Редактирование доступа к статье (PUT /api/admin/articles/{url}/access)
// ─────────────────────────────────────────────────────────────
function openAccessEditor(articleUrl) {
    const article = articlesCache.find(a => a.article_url === articleUrl);
    if (!article) return;

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
        redirectToLogin();
        return;
    }

    editingArticleUrl = articleUrl;

    const titleEl = document.getElementById('access-article-title');
    if (titleEl) titleEl.textContent = article.title || articleUrl;

    populateUserSelect(document.getElementById('access-users'), article.allowed_user_ids || []);
    populateSpecialtySelect(document.getElementById('access-specialties'), article.allowed_specialty_codes || []);
    setStatus(document.getElementById('access-status'), '', '');

    const modal = document.getElementById('access-modal');
    if (modal) modal.hidden = false;
}

function closeAccessEditor() {
    editingArticleUrl = null;
    const modal = document.getElementById('access-modal');
    if (modal) modal.hidden = true;
}

async function saveAccess() {
    const usersSelect = document.getElementById('access-users');
    const specialtiesSelect = document.getElementById('access-specialties');
    const statusEl = document.getElementById('access-status');
    const btn = document.getElementById('access-save-btn');

    if (!editingArticleUrl || !btn) return;

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
        redirectToLogin();
        return;
    }

    const userIds = readSelectedUserIds(usersSelect);
    const specialtyCodes = readSelectedSpecialtyCodes(specialtiesSelect);

    // Пустые оба списка -> global-доступ. Требуем явного подтверждения.
    if (userIds.length === 0 && specialtyCodes.length === 0) {
        if (!confirm('Правила доступа будут очищены. Статья станет доступна всем пользователям. Продолжить?')) {
            return;
        }
    }

    setStatus(statusEl, 'Сохранение…', '');
    btn.disabled = true;

    const encodedUrl = encodeURIComponent(editingArticleUrl);

    let res;
    try {
        res = await fetch(`${API_URL}/admin/articles/${encodedUrl}/access`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ user_ids: userIds, specialty_codes: specialtyCodes })
        });
    } catch (e) {
        setStatus(statusEl, 'Ошибка сети', 'err');
        btn.disabled = false;
        return;
    }

    if (res.status === 401) {
        clearToken();
        redirectToLogin();
        return;
    }

    if (res.status === 403) {
        setStatus(statusEl, 'Доступ запрещён', 'err');
        btn.disabled = false;
        return;
    }

    let data;
    try {
        data = await res.json();
    } catch (e) {
        data = null;
    }

    if (!res.ok) {
        const msg = data && (data.detail || data.error) ? (data.detail || data.error) : `Ошибка (${res.status})`;
        setStatus(statusEl, msg, 'err');
        btn.disabled = false;
        return;
    }

    closeAccessEditor();
    await loadArticles();
}

// ─────────────────────────────────────────────────────────────
// Удаление статьи (DELETE /api/admin/articles/{url})
// ─────────────────────────────────────────────────────────────
async function deleteArticle(articleUrl) {
    if (!confirm('Удалить статью? Это удалит PDF, чанки и правила доступа.')) return;

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
        redirectToLogin();
        return;
    }

    const encodedUrl = encodeURIComponent(articleUrl);

    let res;
    try {
        res = await fetch(`${API_URL}/admin/articles/${encodedUrl}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (e) {
        alert('Ошибка сети при удалении статьи');
        return;
    }

    if (res.status === 401) {
        clearToken();
        redirectToLogin();
        return;
    }

    if (res.status === 403) {
        alert('Доступ запрещён');
        return;
    }

    if (res.status === 404) {
        alert('Статья не найдена');
        await loadArticles();
        return;
    }

    if (!res.ok) {
        let data = null;
        try {
            data = await res.json();
        } catch (e) {
            data = null;
        }
        alert(data && data.detail ? data.detail : `Ошибка (${res.status})`);
        return;
    }

    await loadArticles();
}

// ─────────────────────────────────────────────────────────────
// Инициализация
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderCurrentUser();

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Делегирование клика по кнопке «Сохранить» (строки рендерятся динамически).
    const listEl = document.getElementById('users-list');
    if (listEl) {
        listEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.save-btn');
            if (!btn) return;
            const row = btn.closest('tr[data-user-id]');
            if (!row) return;
            saveUser(row.dataset.userId, row);
        });
    }

    // ── Загрузка статьи ──
    const uploadBtn = document.getElementById('article-upload-btn');
    if (uploadBtn) uploadBtn.addEventListener('click', uploadArticle);

    // ── Делегирование кликов в таблице статей (Доступ / Удалить) ──
    const articlesListEl = document.getElementById('articles-list');
    if (articlesListEl) {
        articlesListEl.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.edit-access-btn');
            if (editBtn) {
                const row = editBtn.closest('tr[data-article-url]');
                if (row) openAccessEditor(row.dataset.articleUrl);
                return;
            }
            const delBtn = e.target.closest('.delete-article-btn');
            if (delBtn) {
                const row = delBtn.closest('tr[data-article-url]');
                if (row) deleteArticle(row.dataset.articleUrl);
            }
        });
    }

    // ── Редактор доступа ──
    const accessSaveBtn = document.getElementById('access-save-btn');
    if (accessSaveBtn) accessSaveBtn.addEventListener('click', saveAccess);

    const accessCancelBtn = document.getElementById('access-cancel-btn');
    if (accessCancelBtn) accessCancelBtn.addEventListener('click', closeAccessEditor);

    // Сначала пользователи (нужны для селекторов доступа), затем статьи.
    loadUsers().then(() => loadArticles());
});
