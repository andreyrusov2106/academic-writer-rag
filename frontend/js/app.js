// ═══════════════════════════════════════════════════════════
// ГЛАВНЫЙ ФАЙЛ (ИНИЦИАЛИЗАЦИЯ)
// ═══════════════════════════════════════════════════════════

async function checkApiStatus() {
    try {
        const res = await fetch(`${API_URL}/health`);
        const data = await res.json();
        const badge = document.getElementById('api-status-badge');
        if (badge) {
            if (data.status === 'healthy') {
                badge.textContent = 'API: онлайн';
                badge.className = 'api-status-badge online';
            } else {
                badge.textContent = 'API: офлайн';
                badge.className = 'api-status-badge offline';
            }
        }
        console.info('API online', data.status);
    } catch (e) {
        const badge = document.getElementById('api-status-badge');
        if (badge) {
            badge.textContent = 'API: офлайн';
            badge.className = 'api-status-badge offline';
        }
        console.warn('API check failed:', e.message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Инициализация редактора
    initEditor();
    
    // Инициализация чата
    initChat();
    
    // Инициализация умного редактора
    initSmartEditor();
    
    // Инициализация голосового ввода
    initChatVoice();
    initEditorVoice();
    loadVoiceLangSettings();  // ← ДОБАВИТЬ ЭТУ СТРОКУ
    
    // Загрузка темы
    loadTheme();
    
    // Загрузка сохраненного контента.
    // Сохранённый HTML пропускаем через Quill Clipboard-конвертер, который
    // строит Delta и отбрасывает script/event-handler узлы, не исполняя их.
    const savedContent = localStorage.getItem('academic_writer_content');
    if (savedContent) {
        try {
            const delta = quill.clipboard.convert({ html: savedContent });
            quill.setContents(delta);
        } catch (e) {
            console.error('Не удалось восстановить документ:', e);
        }
        showNotification(' Документ восстановлен');
    }

    // Проверка API
    checkApiStatus();
    
    // Обновление счетчика слов
    updateWordCount();
    
    // Обработчики событий для модальных окон
    document.getElementById('term-modal').addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });
    
    document.getElementById('search-modal').addEventListener('click', function(e) {
        if (e.target === this) closeSearchModal();
    });
    
    document.getElementById('smart-sources-popup').addEventListener('click', function(e) {
        if (e.target === this) closeSourcesPopup();
    });
});