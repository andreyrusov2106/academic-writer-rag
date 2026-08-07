const translations = {
ru: {
exportDocx: 'Экспорт DOCX',
exportPdf: 'Экспорт PDF',
addTerm: '+ Добавить термин',
send: 'Отправить',
clearChat: 'Очистить чат',
uploadPdf: 'Загрузить PDF',
placeholder: 'Задайте вопрос...',
logout: 'Выйти',
terms: 'Термины',
sources: 'Источники',
smartActions: 'Умные действия',
rewrite: 'Научный рерайт',
translate: 'Перевод на китайский',
findSources: 'Найти источники',
tableOfContents: 'Оглавление',
lightTheme: 'Светлая тема',
bibliography: 'Список литературы',
dictate: 'Диктовать',
dragDropText: 'Перетащите PDF-файл сюда или нажмите для выбора',
voiceInput: 'Голосовой ввод'
},
zh: {
exportDocx: '导出 DOCX',
exportPdf: '导出 PDF',
addTerm: '+ 添加术语',
send: '发送',
clearChat: '清除聊天',
uploadPdf: '上传 PDF',
placeholder: '请输入问题...',
logout: '退出',
terms: '术语',
sources: '来源',
smartActions: '智能操作',
rewrite: '学术改写',
translate: '翻译成中文',
findSources: '查找来源',
tableOfContents: '目录',
lightTheme: '浅色主题',
bibliography: '参考文献',
dictate: '听写',
dragDropText: '将 PDF 文件拖放到此处或点击选择',
voiceInput: '语音输入'
}
};

let currentLang = localStorage.getItem('academic_writer_lang') || 'ru';

function setLanguage(lang) {
currentLang = lang;
localStorage.setItem('academic_writer_lang', lang);
updateInterfaceText();
}

function updateInterfaceText() {
const t = translations[currentLang];

// Обновляем кнопки экспорта
const exportDocxBtn = document.getElementById('export-docx-btn');
if (exportDocxBtn) exportDocxBtn.textContent = t.exportDocx;

const exportPdfBtn = document.getElementById('export-pdf-btn');
if (exportPdfBtn) exportPdfBtn.textContent = t.exportPdf;

// Кнопка добавления термина
const addTermBtn = document.getElementById('add-term-btn');
if (addTermBtn) addTermBtn.textContent = t.addTerm;

// Кнопка отправки
const sendBtn = document.getElementById('send-btn');
if (sendBtn) sendBtn.textContent = t.send;

// Кнопка очистки чата
const clearBtn = document.getElementById('clear-chat-btn');
if (clearBtn) clearBtn.textContent = t.clearChat;

// Кнопка загрузки PDF
const uploadBtn = document.getElementById('upload-pdf-btn');
if (uploadBtn) uploadBtn.textContent = t.uploadPdf;

// Плейсхолдер инпута
const chatInput = document.getElementById('chat-input');
if (chatInput) chatInput.placeholder = t.placeholder;

// Кнопка выхода
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) logoutBtn.textContent = t.logout;

// Заголовки секций
const termsTitle = document.getElementById('terms-title');
if (termsTitle) termsTitle.textContent = t.terms;

const sourcesTitle = document.getElementById('sources-title');
if (sourcesTitle) sourcesTitle.textContent = t.sources;

const smartActionsTitle = document.getElementById('smart-actions-title');
if (smartActionsTitle) smartActionsTitle.textContent = t.smartActions;

// Обновляем кнопку языка
const langToggleText = document.getElementById('lang-toggle-text');
if (langToggleText) {
    langToggleText.textContent = currentLang === 'ru' ? 'CN' : 'RU';
}

// Оглавление
const tocBtn = document.querySelector('[onclick="generateTOC()"]');
if (tocBtn) tocBtn.textContent = t.tableOfContents;

// Светлая тема - теперь обрабатывается через toggleTheme() в editor.js

// Список литературы
const biblioBtn = document.querySelector('[onclick="generateBibliography()"]');
if (biblioBtn) biblioBtn.textContent = t.bibliography;

// Диктовать (кнопка голосового ввода в редакторе)
const dictateBtn = document.getElementById('editor-voice-btn');
if (dictateBtn) {
    // Сохраняем иконку микрофона и добавляем перевод
    const micIcon = '🎤 ';
    dictateBtn.textContent = `${micIcon}${t.dictate}`;
}

// Текст зоны перетаскивания файлов
const dragDropText = document.getElementById('drag-drop-text');
if (dragDropText) dragDropText.textContent = t.dragDropText;
}

// Инициализация языка при загрузке
document.addEventListener('DOMContentLoaded', () => {
updateInterfaceText();

// Обработчик клика на кнопку переключения темы
const themeToggleBtn = document.getElementById('theme-toggle-btn');
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
}

// Обработчик клика на кнопку переключения языка
const langToggle = document.getElementById('lang-toggle');
if (langToggle) {
    langToggle.addEventListener('click', () => {
        const newLang = currentLang === 'ru' ? 'zh' : 'ru';
        setLanguage(newLang);
    });
}
});

// Экспорт переменных для использования в других скриптах (например, voice.js)
window.translations = translations;
window.currentLang = currentLang;

// Обновляем currentLang при смене языка
const originalSetLanguage = setLanguage;
setLanguage = function(lang) {
    originalSetLanguage(lang);
    window.currentLang = currentLang;
};
