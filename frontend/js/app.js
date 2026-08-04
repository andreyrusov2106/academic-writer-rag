// ═══════════════════════════════════════════════════════════
// ГЛАВНЫЙ ФАЙЛ (ИНИЦИАЛИЗАЦИЯ)
// ═══════════════════════════════════════════════════════════

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
    
    // Загрузка сохраненного контента
    const savedContent = localStorage.getItem('academic_writer_content');
    if (savedContent) {
        quill.root.innerHTML = savedContent;
        showNotification(' Документ восстановлен');
    }
    
    // Загрузка ГОСТ
    const savedGost = localStorage.getItem('academic_writer_gost');
    if (savedGost) {
        document.getElementById('gost-select').value = savedGost;
        applyGost(false);
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