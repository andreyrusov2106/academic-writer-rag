// ═══════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════

//const API_URL = 'http://localhost:8000';

function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

async function checkApiStatus() {
    const statusEl = document.getElementById('chat-status');
    try {
        const response = await fetch(`${API_URL}/health`, { 
            signal: AbortSignal.timeout(5000) 
        });
        if (response.ok) {
            const data = await response.json();
            statusEl.textContent = `✓ База: ${data.documents_count} чанков`;
            statusEl.style.color = '#4caf50';
        } else {
            throw new Error('API недоступен');
        }
    } catch (error) {
        statusEl.textContent = '✗ API недоступен';
        statusEl.style.color = '#f44336';
    }
}