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
        <tr>
            <td>${escapeHtml(u.id)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td><span class="badge ${u.is_admin ? 'badge-admin' : 'badge-user'}">${u.is_admin ? 'админ' : 'пользователь'}</span></td>
            <td>${escapeHtml(u.specialty_code ?? '—')}</td>
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
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
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

    renderUsers(data.users);
}

// ─────────────────────────────────────────────────────────────
// Инициализация
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderCurrentUser();

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    loadUsers();
});
