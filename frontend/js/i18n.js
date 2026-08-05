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
findSources: 'Найти источники'
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
findSources: '查找来源'
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

// Обновляем флажок языка
const langToggle = document.getElementById('lang-toggle');
if (langToggle) {
    langToggle.textContent = currentLang === 'ru' ? '🇨🇳' : '🇷🇺';
}
}

// Инициализация языка при загрузке
document.addEventListener('DOMContentLoaded', () => {
updateInterfaceText();

// Обработчик клика на флажок
const langToggle = document.getElementById('lang-toggle');
if (langToggle) {
    langToggle.addEventListener('click', () => {
        const newLang = currentLang === 'ru' ? 'zh' : 'ru';
        setLanguage(newLang);
    });
}
});
