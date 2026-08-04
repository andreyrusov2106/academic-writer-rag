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
    
    // Отслеживаем выделение текста в редакторе
    quill.on('selection-change', function(range, oldRange, source) {
        console.log('📍 selection-change:', { range, source });
        
        if (range && range.length > 0) {
            selectedText = quill.getText(range.index, range.length).trim();
            selectedRange = range;
            
            console.log('📝 Выделен текст:', selectedText);
            console.log(' Длина:', selectedText.length);
            
            if (selectedText.length > 10) {
                // Получаем координаты выделения
                const bounds = quill.getBounds(range.index, range.length);
                console.log('📐 Bounds:', bounds);
                
                const editorRect = document.getElementById('editor-container').getBoundingClientRect();
                console.log(' Editor rect:', editorRect);
                
                const left = editorRect.left + bounds.left + window.scrollX;
                const top = editorRect.top + bounds.bottom + window.scrollY + 10;
                
                menu.style.left = left + 'px';
                menu.style.top = top + 'px';
                menu.classList.add('visible');
                
                console.log('✅ Меню показано на координатах:', left, top);
            } else {
                menu.classList.remove('visible');
                console.log('⚠️ Текст слишком короткий (< 10 символов)');
            }
        } else {
            // Выделение снято
            menu.classList.remove('visible');
            console.log('🔕 Выделение снято, меню скрыто');
        }
    });
    
    // Скрываем меню при клике ВНЕ его
    document.addEventListener('click', function(e) {
        const isClickOnMenu = menu.contains(e.target);
        const isClickOnEditor = e.target.closest('.ql-editor');
        
        if (!isClickOnMenu && !isClickOnEditor) {
            menu.classList.remove('visible');
            selectedText = '';
            selectedRange = null;
            console.log('🖱️ Клик вне меню и редактора, выделение очищено');
        }
    });
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: textToUse,  // Используем сохраненный текст
                action: action
            })
        });
        
        console.log('📥 Ответ от сервера:', response.status);
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
    
    let html = `<div style="margin-bottom: 20px; padding: 15px; background: #e3f2fd; border-radius: 8px;">`;
    html += `<strong>📊 Анализ:</strong><br>${analysis.replace(/\n/g, '<br>')}`;
    html += `</div>`;
    
    if (sources && sources.length > 0) {
        html += '<strong>📚 Источники:</strong><br><br>';
        sources.forEach((source, index) => {
            html += `<div style="margin-bottom: 10px; padding: 10px; background: #f9f9f9; border-radius: 5px; border-left: 3px solid #667eea;">`;
            html += `<strong>${index + 1}. ${source.title}</strong><br>`;
            html += `<em style="font-size: 12px; color: #666;">${source.chunk_text}</em>`;
            html += `</div>`;
        });
    } else {
        html += '<p style="color: #999;">Источники не найдены</p>';
    }
    
    content.innerHTML = html;
    popup.classList.add('visible');
}

window.closeSourcesPopup = function closeSourcesPopup() {
    document.getElementById('smart-sources-popup').classList.remove('visible');
};