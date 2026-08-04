// ═══════════════════════════════════════════════════════════
// ГОЛОСОВОЙ ВВОД (Web Speech API) с переключением языка
// ═══════════════════════════════════════════════════════════

let chatRecognition = null;
let editorRecognition = null;
let isChatRecording = false;
let isEditorRecording = false;
let chatVoiceLang = 'ru-RU';  // Язык для чата
let editorVoiceLang = 'ru-RU';  // Язык для редактора

// Проверка поддержки Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
    console.warn('⚠️ Web Speech API не поддерживается в этом браузере');
}

// ═══════════════════════════════════════════════════════════
// ПЕРЕКЛЮЧЕНИЕ ЯЗЫКА
// ═══════════════════════════════════════════════════════════

function setChatVoiceLang(lang) {
    chatVoiceLang = lang;
    document.getElementById('chat-lang-ru').classList.toggle('active', lang === 'ru-RU');
    document.getElementById('chat-lang-cn').classList.toggle('active', lang === 'zh-CN');
    localStorage.setItem('chat_voice_lang', lang);
    
    // Если идет запись, перезапускаем с новым языком
    if (isChatRecording) {
        stopChatVoice();
        setTimeout(() => startChatVoice(), 100);
    }
    
    showNotification(`Язык распознавания: ${lang === 'ru-RU' ? 'Русский' : '中文'}`);
}

function setEditorVoiceLang(lang) {
    editorVoiceLang = lang;
    document.getElementById('editor-lang-ru').classList.toggle('active', lang === 'ru-RU');
    document.getElementById('editor-lang-cn').classList.toggle('active', lang === 'zh-CN');
    localStorage.setItem('editor_voice_lang', lang);
    
    // Если идет запись, перезапускаем с новым языком
    if (isEditorRecording) {
        stopEditorVoice();
        setTimeout(() => startEditorVoice(), 100);
    }
    
    showNotification(`Язык распознавания: ${lang === 'ru-RU' ? 'Русский' : '中文'}`);
}

function loadVoiceLangSettings() {
    const savedChatLang = localStorage.getItem('chat_voice_lang');
    if (savedChatLang) {
        setChatVoiceLang(savedChatLang);
    }
    
    const savedEditorLang = localStorage.getItem('editor_voice_lang');
    if (savedEditorLang) {
        setEditorVoiceLang(savedEditorLang);
    }
}

// ═══════════════════════════════════════════════════════════
// ГОЛОСОВОЙ ВВОД В ЧАТ
// ═══════════════════════════════════════════════════════════

function initChatVoice() {
    if (!SpeechRecognition) return;
    
    chatRecognition = new SpeechRecognition();
    chatRecognition.lang = chatVoiceLang;
    chatRecognition.continuous = true;
    chatRecognition.interimResults = true;
    
    let finalTranscript = '';
    
    chatRecognition.onstart = function() {
        isChatRecording = true;
        document.getElementById('chat-voice-btn').classList.add('recording');
        const langName = chatVoiceLang === 'ru-RU' ? 'Русский' : '中文';
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
        chatRecognition.lang = chatVoiceLang;
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
    editorRecognition.lang = editorVoiceLang;
    editorRecognition.continuous = true;
    editorRecognition.interimResults = true;
    
    let finalTranscript = '';
    let editorStartIndex = 0;
    
    editorRecognition.onstart = function() {
        isEditorRecording = true;
        const range = quill.getSelection();
        editorStartIndex = range ? range.index : quill.getLength();
        const langName = editorVoiceLang === 'ru-RU' ? 'Русский' : '中文';
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
    
    if (isEditorRecording) {
        stopEditorVoice();
        if (btn) {
            btn.classList.remove('recording');
            btn.textContent = '🎤 Диктовать';
        }
    } else {
        startEditorVoice();
        if (btn) {
            btn.classList.add('recording');
            btn.textContent = '⏹️ Остановить';
        }
    }
}

function startEditorVoice() {
    try {
        editorRecognition.lang = editorVoiceLang;
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
window.setChatVoiceLang = setChatVoiceLang;
window.setEditorVoiceLang = setEditorVoiceLang;
window.loadVoiceLangSettings = loadVoiceLangSettings;