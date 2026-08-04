// ══════════════════════════════════════════════════════════
// РЕДАКТОР (Quill, ГОСТ, экспорт)
// ═══════════════════════════════════════════════════════════

let quill;

function initEditor() {
    quill = new Quill('#editor', {
        theme: 'snow',
        modules: {
            toolbar: [
				[{ 'header': [1, 2, 3, false] }],
				['bold', 'italic', 'underline', 'strike'],
				[{ 'list': 'ordered'}, { 'list': 'bullet' }],
				[{ 'align': [] }],
				['blockquote', 'code-block'],
				['link', 'image'],
				['clean'],
				[{ 'voice': true }]  // ← Добавляем кнопку голоса
			]
        }
    });
    
    // Автосохранение
    let saveTimeout;
    quill.on('text-change', () => {
        updateWordCount();
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            localStorage.setItem('academic_writer_content', quill.root.innerHTML);
        }, 2000);
    });
}

function updateWordCount() {
    const text = quill.getText().trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.length;
    const pages = Math.max(1, Math.ceil(words / 250));
    
    let counter = document.getElementById('word-counter');
    if (!counter) {
        counter = document.createElement('div');
        counter.id = 'word-counter';
        counter.style.cssText = 'position: fixed; bottom: 10px; left: 10px; background: rgba(102, 126, 234, 0.9); color: white; padding: 8px 15px; border-radius: 20px; font-size: 13px; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.2);';
        document.body.appendChild(counter);
    }
    counter.textContent = `📝 ${words} слов | ${chars} симв. | ~${pages} стр.`;
}

function applyGost(showNotification = true) {
    const select = document.getElementById('gost-select');
    const editorContainer = document.getElementById('editor-container');
    editorContainer.className = 'editor-container';
    if (select.value !== 'free') {
        editorContainer.classList.add(select.value);
    }
    if (showNotification) {
        showNotification(`Применён: ${select.options[select.selectedIndex].text}`);
    }
    localStorage.setItem('academic_writer_gost', select.value);
}

function generateTOC() {
    const editor = quill.root;
    const headings = editor.querySelectorAll('h1, h2, h3');
    
    if (headings.length === 0) {
        showNotification('⚠️ Заголовки не найдены. Используйте форматирование H1, H2, H3.');
        return;
    }
    
    let tocHtml = '<h2>Оглавление</h2><p><br></p>';
    let counter = 0;
    
    headings.forEach((h) => {
        const level = h.tagName.toLowerCase();
        const text = h.innerText.trim();
        if (!text) return;
        
        counter++;
        let indent = 0;
        if (level === 'h2') indent = 20;
        if (level === 'h3') indent = 40;
        
        tocHtml += `<p style="margin-left: ${indent}px; margin-bottom: 5px;">${counter}. ${text}</p>`;
    });
    
    tocHtml += '<p><br></p><hr><p><br></p>';
    
    let range = quill.getSelection();
    let index = range ? range.index : 0;
    
    quill.clipboard.dangerouslyPasteHTML(index, tocHtml);
    showNotification(`📑 Оглавление сгенерировано (${counter} пунктов)`);
}

function generateBibliography() {
    if (typeof allSources === 'undefined' || allSources.length === 0) {
        showNotification('⚠️ В истории чата нет источников. Задайте вопрос профессору Копцевой.');
        return;
    }
    
    let bibliographyHtml = '<h2>Список литературы</h2><p><br></p>';
    bibliographyHtml += '<ol style="margin-left: 20px;">';
    
    allSources.forEach((source, index) => {
        const title = source.title || 'Без названия';
        const url = source.article_url || '';
        
        bibliographyHtml += `<li style="margin-bottom: 10px;">`;
        bibliographyHtml += `${title}.`;
        if (url) {
            bibliographyHtml += ` — URL: ${url}`;
        }
        bibliographyHtml += `</li>`;
    });
    
    bibliographyHtml += '</ol>';
    bibliographyHtml += '<p><br></p>';
    
    let range = quill.getSelection();
    let index = range ? range.index : quill.getLength();
    
    quill.clipboard.dangerouslyPasteHTML(index, bibliographyHtml);
    showNotification(`📚 Список литературы сгенерирован (${allSources.length} источников)`);
}

function exportDocx() {
    const editorContent = document.getElementById('editor-container').innerHTML;
    const gostSelect = document.getElementById('gost-select');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body { font-family: 'Times New Roman', serif; }.gost-report { font-size: 14pt; line-height: 1.5; text-align: justify; }.gost-report p { text-indent: 1.25cm; }.gost-thesis { font-size: 14pt; line-height: 1.5; text-align: justify; }.gost-thesis p { text-indent: 1.25cm; }.gost-article { font-size: 12pt; line-height: 1.15; text-align: justify; }.gost-article p { text-indent: 1cm; }</style></head><body class="${gostSelect.value}">${editorContent}</body></html>`;
    const converted = htmlDocx.asBlob(html);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(converted);
    link.download = `document_${Date.now()}.docx`;
    link.click();
    showNotification('📄 Экспортировано в DOCX');
}

function exportPdf() {
    const element = document.getElementById('editor-container');
    const opt = { 
        margin: [20, 15, 20, 30], 
        filename: `document_${Date.now()}.pdf`, 
        image: { type: 'jpeg', quality: 0.98 }, 
        html2canvas: { scale: 2 }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };
    html2pdf().set(opt).from(element).save().then(() => {
        showNotification('📕 Экспортировано в PDF');
    });
}

function toggleTheme() {
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    document.getElementById('theme-btn').textContent = isDark ? '☀️ Светлая тема' : '🌙 Темная тема';
    localStorage.setItem('academic_writer_theme', isDark ? 'dark' : 'light');
}

function loadTheme() {
    const savedTheme = localStorage.getItem('academic_writer_theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        setTimeout(() => {
            const btn = document.getElementById('theme-btn');
            if (btn) btn.textContent = '☀️ Светлая тема';
        }, 100);
    }
}

// Регистрация кастомной кнопки микрофона в Quill
const VoiceButton = Quill.import('ui/button');

class VoiceEditorButton extends VoiceButton {
    constructor(quill, options) {
        super(quill, options);
        this.quill = quill;
    }
    
    handleClick() {
        toggleEditorVoice();
    }
}

Quill.register('modules/voiceButton', VoiceEditorButton);