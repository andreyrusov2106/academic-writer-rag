// ══════════════════════════════════════════════════════════
// ПОИСК В OPENALEX
// ═══════════════════════════════════════════════════════════

// Возвращает URL только если он безопасен для href (http/https).
// Отклоняет javascript:, data: и прочие небезопасные схемы.
function safeExternalUrl(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return /^https?:\/\//i.test(v) ? v : null;
}

function openSearchModal() {
    const chatInput = document.getElementById('chat-input').value.trim();
    if (chatInput) {
        document.getElementById('search-query').value = chatInput;
    }
    document.getElementById('search-modal').classList.add('active');
}

function closeSearchModal() {
    document.getElementById('search-modal').classList.remove('active');
}

async function executeSearch() {
    const query = document.getElementById('search-query').value.trim();
    if (!query) {
        showNotification('⚠️ Введите запрос для поиска');
        return;
    }
    
    const author = document.getElementById('search-author').value.trim();
    const yearFrom = document.getElementById('search-year-from').value;
    const yearTo = document.getElementById('search-year-to').value;
    const limit = document.getElementById('search-limit').value;
    const openAccess = document.getElementById('search-open-access').checked;
    
    closeSearchModal();
    
    const messagesDiv = document.getElementById('chat-messages');
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-message user';
    userMsg.textContent = `🔍 Расширенный поиск: "${query}"${author ? ` (автор: ${author})` : ''}${yearFrom || yearTo ? ` (${yearFrom || '...'}-${yearTo || '...'})` : ''}`;
    messagesDiv.appendChild(userMsg);
    
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-message bot';
    loadingDiv.innerHTML = '<em>Ищу в OpenAlex...</em>';
    messagesDiv.appendChild(loadingDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    try {
        let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}&sort=relevance_score:desc`;
        
        const filters = [];
        if (yearFrom || yearTo) {
            const yearRange = `${yearFrom || ''}-${yearTo || ''}`;
            filters.push(`publication_year:${yearRange}`);
        }
        if (openAccess) {
            filters.push('is_oa:true');
        }
        if (filters.length > 0) {
            url += `&filter=${filters.join(',')}`;
        }
        
        if (author) {
            const authorResponse = await fetch(
                `https://api.openalex.org/authors?search=${encodeURIComponent(author)}&per_page=1`
            );
            const authorData = await authorResponse.json();
            
            if (authorData.results && authorData.results.length > 0) {
                const authorId = authorData.results[0].id;
                url += `&filter=author.id:${authorId.replace('https://openalex.org/', '')}`;
            }
        }
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        loadingDiv.remove();
        
        if (data.results && data.results.length > 0) {
            const resultDiv = document.createElement('div');
            resultDiv.className = 'chat-message bot';

            const container = document.createElement('div');
            container.style.cssText = 'margin-top: 10px; padding: 10px; background: #e3f2fd; border-radius: 8px;';

            const header = document.createElement('strong');
            header.textContent = ` Найдено ${data.meta.count} статей (показано ${data.results.length}):`;
            container.appendChild(header);
            container.appendChild(document.createElement('br'));
            container.appendChild(document.createElement('br'));

            data.results.forEach((work, index) => {
                const title = work.title || 'Без названия';
                const year = work.publication_year || 'н/д';
                const authors = work.authorships
                    ? work.authorships.slice(0, 3).map(a => a.author.display_name).join(', ')
                    : 'н/д';
                const doi = work.doi || '';
                const url = safeExternalUrl(doi ? `https://doi.org/${doi.replace('https://doi.org/', '')}` : '');
                const oa = work.open_access?.is_oa ? '🟢 OA' : '';

                const item = document.createElement('div');
                item.style.cssText = 'margin-bottom: 10px; padding: 8px; background: white; border-radius: 5px;';

                const titleStrong = document.createElement('strong');
                titleStrong.textContent = `${index + 1}. ${title}`;
                item.appendChild(titleStrong);
                if (oa) item.appendChild(document.createTextNode(' ' + oa));
                item.appendChild(document.createElement('br'));

                const authorsEm = document.createElement('em');
                authorsEm.textContent = 'Авторы:';
                item.appendChild(authorsEm);
                item.appendChild(document.createTextNode(' ' + authors));
                item.appendChild(document.createElement('br'));

                const yearEm = document.createElement('em');
                yearEm.textContent = 'Год:';
                item.appendChild(yearEm);
                item.appendChild(document.createTextNode(' ' + year));
                item.appendChild(document.createElement('br'));

                if (url) {
                    const a = document.createElement('a');
                    a.href = url;
                    a.target = '_blank';
                    a.style.color = '#667eea';
                    a.textContent = '📄 Открыть статью';
                    item.appendChild(a);
                }

                container.appendChild(item);
            });

            container.appendChild(document.createElement('br'));
            const tip = document.createElement('em');
            tip.style.cssText = 'font-size: 11px; color: #666;';
            tip.textContent = '💡 Чтобы добавить статью в базу знаний, скачайте PDF и загрузите через панель справа';
            container.appendChild(tip);

            resultDiv.appendChild(container);
            messagesDiv.appendChild(resultDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;

            showNotification(`🔍 Найдено ${data.meta.count} статей`);
        } else {
            const noResultDiv = document.createElement('div');
            noResultDiv.className = 'chat-message bot';
            noResultDiv.textContent = 'К сожалению, научные статьи по этому запросу не найдены.';
            messagesDiv.appendChild(noResultDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    } catch (error) {
        loadingDiv.textContent = '';
        const errSpan = document.createElement('span');
        errSpan.style.color = 'red';
        errSpan.textContent = 'Ошибка поиска: ' + String(error.message);
        loadingDiv.appendChild(errSpan);
        console.error('Ошибка OpenAlex:', error);
    }
}