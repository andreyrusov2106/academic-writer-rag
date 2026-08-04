// ══════════════════════════════════════════════════════════
// ПОИСК В OPENALEX
// ═══════════════════════════════════════════════════════════

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
            let resultsHtml = '<div style="margin-top: 10px; padding: 10px; background: #e3f2fd; border-radius: 8px;">';
            resultsHtml += `<strong> Найдено ${data.meta.count} статей (показано ${data.results.length}):</strong><br><br>`;
            
            data.results.forEach((work, index) => {
                const title = work.title || 'Без названия';
                const year = work.publication_year || 'н/д';
                const authors = work.authorships 
                    ? work.authorships.slice(0, 3).map(a => a.author.display_name).join(', ')
                    : 'н/д';
                const doi = work.doi || '';
                const url = doi ? `https://doi.org/${doi.replace('https://doi.org/', '')}` : '';
                const oa = work.open_access?.is_oa ? '🟢 OA' : '';
                
                resultsHtml += `<div style="margin-bottom: 10px; padding: 8px; background: white; border-radius: 5px;">`;
                resultsHtml += `<strong>${index + 1}. ${title}</strong> ${oa}<br>`;
                resultsHtml += `<em>Авторы:</em> ${authors}<br>`;
                resultsHtml += `<em>Год:</em> ${year}<br>`;
                if (url) {
                    resultsHtml += `<a href="${url}" target="_blank" style="color: #667eea;">📄 Открыть статью</a>`;
                }
                resultsHtml += `</div>`;
            });
            
            resultsHtml += '<br><em style="font-size: 11px; color: #666;">💡 Чтобы добавить статью в базу знаний, скачайте PDF и загрузите через панель справа</em>';
            resultsHtml += '</div>';
            
            const resultDiv = document.createElement('div');
            resultDiv.className = 'chat-message bot';
            resultDiv.innerHTML = resultsHtml;
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
        loadingDiv.innerHTML = `<span style="color: red;">Ошибка поиска: ${error.message}</span>`;
        console.error('Ошибка OpenAlex:', error);
    }
}