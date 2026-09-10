// ═══════════════════════════════════════════════════════════
// УМНЫЙ РЕДАКТОР (ПОЛНОСТЬЮ РАБОЧАЯ ВЕРСИЯ)
// ═══════════════════════════════════════════════════════════

let selectedText = '';
let selectedRange = null;

function initSmartEditor() {
    console.log('🔧 initSmartEditor вызван');
    
    const menu = document.getElementById('smart-menu');
    if (!menu) {
        console.error('❌ Элемент #smart-menu не найден в DOM!');
        return;
    }
    
    // Обработчик для кнопки Smart Actions
    const smartBtn = document.getElementById('smart-actions-btn');
    if (smartBtn) {
        smartBtn.addEventListener('click', function() {
            const currentSelectedText = window.getSelection().toString().trim();
            if (!currentSelectedText) {
                alert('Сначала выделите текст в редакторе');
                return;
            }
            showSmartMenu(currentSelectedText);
        });
    }
    
    // Горячая клавиша Ctrl+M
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'm') {
            e.preventDefault();
            const currentSelectedText = window.getSelection().toString().trim();
            if (!currentSelectedText) {
                alert('Сначала выделите текст в редакторе');
                return;
            }
            showSmartMenu(currentSelectedText);
        }
    });
    
    // Скрываем меню при клике ВНЕ его
    document.addEventListener('click', function(e) {
        const isClickOnMenu = menu.contains(e.target);
        const isClickOnEditor = e.target.closest('.ql-editor');
        const isClickOnSmartBtn = e.target.closest('#smart-actions-btn');
        
        if (!isClickOnMenu && !isClickOnEditor && !isClickOnSmartBtn) {
            menu.classList.remove('visible');
            selectedText = '';
            selectedRange = null;
            console.log('🖱️ Клик вне меню и редактора, выделение очищено');
        }
    });
}

function showSmartMenu(text) {
    console.log('📍 showSmartMenu вызван с текстом:', text);
    
    const menu = document.getElementById('smart-menu');
    if (!menu) {
        console.error('❌ Элемент #smart-menu не найден в DOM!');
        return;
    }
    
    selectedText = text;
    
    // Получаем координаты выделения через Quill
    const range = quill.getSelection(true);
    if (range && range.length > 0) {
        selectedRange = range;
        const bounds = quill.getBounds(range.index, range.length);
        
        const editorRect = document.getElementById('editor-container').getBoundingClientRect();
        
        const left = editorRect.left + bounds.left + window.scrollX;
        const top = editorRect.top + bounds.bottom + window.scrollY + 10;
        
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.classList.add('visible');
        
        console.log('✅ Меню показано на координатах:', left, top);
    }
}

window.executeSmartAction = async function executeSmartAction(action) {
    console.log('🎯 executeSmartAction вызван с action:', action);
    console.log('📝 selectedText:', selectedText);
    console.log(' selectedRange:', selectedRange);
    
    // Сохраняем выделение ПЕРЕД тем как скрыть меню
    const rangeToUse = selectedRange ? { ...selectedRange } : null;
    const textToUse = selectedText;
    
    if (!textToUse) {
        console.warn('⚠️ selectedText пустой!');
        showNotification('⚠️ Сначала выделите текст в редакторе');
        return;
    }
    
    const menu = document.getElementById('smart-menu');
    menu.classList.remove('visible');
    
    const processing = document.getElementById('smart-processing');
    const processingText = document.getElementById('smart-processing-text');
    
    const actionNames = {
        'rewrite_scientific': 'Делаю текст более научным...',
        'translate_cn': 'Перевожу на китайский...',
        'find_sources': 'Ищу источники в базе знаний...',
        'fix_style': 'Исправляю стиль и ошибки...'
    };
    
    processingText.textContent = actionNames[action] || 'Обрабатываю...';
    processing.classList.add('visible');
    
    try {
        console.log('📤 Отправляю запрос на /smart-action...');
        const response = await fetch(`${API_URL}/smart-action`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                text: textToUse,  // Используем сохраненный текст
                action: action
            })
        });

        console.log('📥 Ответ от сервера:', response.status);

        // ✅ Обрабатываем ошибки авторизации и лимита до парсинга тела ответа
        if (response.status === 401) {
            processing.classList.remove('visible');
            showNotification('⚠️ Требуется авторизация. Войдите в систему.');
            return;
        }
        if (response.status === 403) {
            processing.classList.remove('visible');
            try {
                const errData = await response.json();
                showNotification(`⚠️ ${errData.detail || 'Лимит запросов исчерпан'}`);
            } catch (e) {
                showNotification('⚠️ Лимит запросов исчерпан');
            }
            return;
        }

        const data = await response.json();
        console.log('📦 Данные:', data);
        
        processing.classList.remove('visible');
        
        if (data.result && !data.result.startsWith('️')) {
            if (action === 'find_sources') {
                showSourcesPopup(data.sources, data.result);
            } else {
                // Используем СОХРАНЕННЫЙ range, не тот что в переменной
                if (rangeToUse) {
                    console.log('✏️ Заменяю текст в позиции:', rangeToUse);
                    quill.deleteText(rangeToUse.index, rangeToUse.length);
                    quill.insertText(rangeToUse.index, data.result);
                    quill.setSelection(rangeToUse.index, data.result.length);
                    showNotification('✨ Текст обновлен');
                } else {
                    console.error('❌ rangeToUse пустой!');
                    showNotification('⚠️ Не удалось заменить текст');
                }
            }
        } else {
            showNotification(`⚠️ ${data.result}`);
        }
        
    } catch (error) {
        processing.classList.remove('visible');
        console.error('❌ Ошибка:', error);
        showNotification(`⚠️ Ошибка: ${error.message}`);
    }
};

function showSourcesPopup(sources, analysis) {
    const popup = document.getElementById('smart-sources-popup');
    const content = document.getElementById('smart-sources-content');

    content.textContent = '';

    // Анализ — текст LLM: выводим как текст, переносы строк сохраняем через pre-wrap.
    const analysisDiv = document.createElement('div');
    analysisDiv.style.cssText = 'margin-bottom: 20px; padding: 15px; background: #e3f2fd; border-radius: 8px;';
    const analysisStrong = document.createElement('strong');
    analysisStrong.textContent = '📊 Анализ:';
    analysisDiv.appendChild(analysisStrong);
    analysisDiv.appendChild(document.createElement('br'));
    const analysisText = document.createElement('span');
    analysisText.style.whiteSpace = 'pre-wrap';
    analysisText.textContent = analysis;
    analysisDiv.appendChild(analysisText);
    content.appendChild(analysisDiv);

    if (sources && sources.length > 0) {
        const header = document.createElement('strong');
        header.textContent = '📚 Источники:';
        content.appendChild(header);
        content.appendChild(document.createElement('br'));
        content.appendChild(document.createElement('br'));

        sources.forEach((source, index) => {
            const item = document.createElement('div');
            item.style.cssText = 'margin-bottom: 10px; padding: 10px; background: #f9f9f9; border-radius: 5px; border-left: 3px solid #667eea;';

            const strong = document.createElement('strong');
            strong.textContent = `${index + 1}. ${source.title}`;
            item.appendChild(strong);
            item.appendChild(document.createElement('br'));

            const em = document.createElement('em');
            em.style.cssText = 'font-size: 12px; color: #666;';
            em.textContent = source.chunk_text;
            item.appendChild(em);

            content.appendChild(item);
        });
    } else {
        const p = document.createElement('p');
        p.style.color = '#999';
        p.textContent = 'Источники не найдены';
        content.appendChild(p);
    }

    popup.classList.add('visible');
}

window.closeSourcesPopup = function closeSourcesPopup() {
    document.getElementById('smart-sources-popup').classList.remove('visible');
};