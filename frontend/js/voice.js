// ═══════════════════════════════════════════════════════════
// ГОЛОСОВОЙ ВВОД (Web Speech API) с переключением языка
// ═══════════════════════════════════════════════════════════

let chatRecognition = null;
let editorRecognition = null;
let isChatRecording = false;
let isEditorRecording = false;

// Получение языка на основе текущего языка интерфейса
function getVoiceLangFromInterface() {
    const lang = typeof window.currentLang !== 'undefined' ? window.currentLang : 'ru';
    return lang === 'ru' ? 'ru-RU' : 'zh-CN';
}

// Проверка поддержки Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
    console.warn('⚠️ Web Speech API не поддерживается в этом браузере');
}

// ═══════════════════════════════════════════════════════════
// ПЕРЕКЛЮЧЕНИЕ ЯЗЫКА (удалено - теперь язык определяется автоматически)
// ═══════════════════════════════════════════════════════════

// Функции setChatVoiceLang и setEditorVoiceLang удалены
// Язык теперь определяется автоматически на основе currentLang из i18n.js

function loadVoiceLangSettings() {
    // Загрузка настроек больше не требуется
    // Язык определяется автоматически из currentLang
}

// ═══════════════════════════════════════════════════════════
// ГОЛОСОВОЙ ВВОД В ЧАТ
// ═══════════════════════════════════════════════════════════

function initChatVoice() {
    if (!SpeechRecognition) return;
    
    chatRecognition = new SpeechRecognition();
    chatRecognition.lang = getVoiceLangFromInterface();
    chatRecognition.continuous = true;
    chatRecognition.interimResults = true;
    
    let finalTranscript = '';
    
    chatRecognition.onstart = function() {
        isChatRecording = true;
        document.getElementById('chat-voice-btn').classList.add('recording');
        const langName = getVoiceLangFromInterface() === 'ru-RU' ? 'Русский' : '中文';
        showVoiceStatus(`Слушаю (${langName})... Говорите вопрос`);
    };
    
    chatRecognition.onresult = function(event) {
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }
        
        const input = document.getElementById('chat-input');
        input.value = finalTranscript + interimTranscript;
        
        const displayText = interimTranscript || finalTranscript;
        if (displayText) {
            showVoiceStatus(`Слышу: "${displayText}"`);
        }
    };
    
    chatRecognition.onerror = function(event) {
        console.error('Ошибка распознавания:', event.error);
        if (event.error !== 'no-speech') {
            showVoiceStatus(`Ошибка: ${event.error}`);
        }
        stopChatVoice();
    };
    
    chatRecognition.onend = function() {
        if (isChatRecording) {
            try {
                chatRecognition.start();
            } catch (e) {
                console.log('Не удалось перезапустить распознавание');
            }
        } else {
            document.getElementById('chat-voice-btn').classList.remove('recording');
            hideVoiceStatus();
        }
    };
}

function toggleChatVoice() {
    if (!chatRecognition) {
        showNotification('⚠️ Голосовой ввод не поддерживается в вашем браузере');
        return;
    }
    
    if (isChatRecording) {
        stopChatVoice();
    } else {
        startChatVoice();
    }
}

function startChatVoice() {
    try {
        chatRecognition.lang = getVoiceLangFromInterface();
        chatRecognition.start();
    } catch (e) {
        console.error('Ошибка запуска распознавания:', e);
    }
}

function stopChatVoice() {
    isChatRecording = false;
    if (chatRecognition) {
        chatRecognition.stop();
    }
    document.getElementById('chat-voice-btn').classList.remove('recording');
    hideVoiceStatus();
}

// ═══════════════════════════════════════════════════════════
// ГОЛОСОВОЙ ВВОД В РЕДАКТОР
// ═══════════════════════════════════════════════════════════

function initEditorVoice() {
    if (!SpeechRecognition) return;
    
    editorRecognition = new SpeechRecognition();
    editorRecognition.lang = getVoiceLangFromInterface();
    editorRecognition.continuous = true;
    editorRecognition.interimResults = true;
    
    let finalTranscript = '';
    let editorStartIndex = 0;
    
    editorRecognition.onstart = function() {
        isEditorRecording = true;
        const range = quill.getSelection();
        editorStartIndex = range ? range.index : quill.getLength();
        const langName = getVoiceLangFromInterface() === 'ru-RU' ? 'Русский' : '中文';
        showVoiceStatus(`Диктую в редактор (${langName})... Говорите текст`);
    };
    
    editorRecognition.onresult = function(event) {
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }
        
        const currentText = quill.getText(editorStartIndex, quill.getLength() - editorStartIndex);
        if (currentText.trim()) {
            quill.deleteText(editorStartIndex, currentText.length);
        }
        
        const textToInsert = finalTranscript + interimTranscript;
        if (textToInsert) {
            quill.insertText(editorStartIndex, textToInsert);
            quill.setSelection(editorStartIndex + textToInsert.length);
        }
        
        const displayText = interimTranscript || finalTranscript;
        if (displayText) {
            showVoiceStatus(`Диктую: "${displayText}"`);
        }
    };
    
    editorRecognition.onerror = function(event) {
        console.error('Ошибка распознавания:', event.error);
        if (event.error !== 'no-speech') {
            showVoiceStatus(`Ошибка: ${event.error}`);
        }
        stopEditorVoice();
    };
    
    editorRecognition.onend = function() {
        if (isEditorRecording) {
            try {
                editorRecognition.start();
            } catch (e) {
                console.log('Не удалось перезапустить распознавание');
            }
        } else {
            hideVoiceStatus();
        }
    };
}

function toggleEditorVoice() {
    if (!editorRecognition) {
        showNotification('⚠️ Голосовой ввод не поддерживается в вашем браузере');
        return;
    }
    
    const btn = document.getElementById('editor-voice-btn');
    const t = typeof window.translations !== 'undefined' ? window.translations[window.currentLang || 'ru'] : null;
    const curLang = typeof window.currentLang !== 'undefined' ? window.currentLang : 'ru';
    
    if (isEditorRecording) {
        stopEditorVoice();
        if (btn) {
            btn.classList.remove('recording');
            btn.textContent = '🎤 ' + (t && t.dictate ? t.dictate : 'Диктовать');
        }
    } else {
        startEditorVoice();
        if (btn) {
            btn.classList.add('recording');
            btn.textContent = '⏹️ ' + (curLang === 'ru' ? 'Остановить' : '停止');
        }
    }
}

function startEditorVoice() {
    try {
        editorRecognition.lang = getVoiceLangFromInterface();
        editorRecognition.start();
    } catch (e) {
        console.error('Ошибка запуска распознавания:', e);
    }
}

function stopEditorVoice() {
    isEditorRecording = false;
    if (editorRecognition) {
        editorRecognition.stop();
    }
    hideVoiceStatus();
}

// ══════════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════════

function showVoiceStatus(text) {
    const status = document.getElementById('voice-status');
    const statusText = document.getElementById('voice-status-text');
    if (status && statusText) {
        statusText.textContent = text;
        status.classList.add('visible');
    }
}

function hideVoiceStatus() {
    const status = document.getElementById('voice-status');
    if (status) {
        status.classList.remove('visible');
    }
}

// Глобальные функции
window.toggleChatVoice = toggleChatVoice;
window.toggleEditorVoice = toggleEditorVoice;
window.loadVoiceLangSettings = loadVoiceLangSettings;