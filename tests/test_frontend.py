"""
Тесты для проверки фронтенд функциональности academic-writer-rag
Запускаются через pytest
"""
import pytest
import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
CSS_FILE = FRONTEND_DIR / "css" / "styles.css"
HTML_FILE = FRONTEND_DIR / "ademic-writer.html"


class TestCSSStyles:
    """Тесты для проверки CSS стилей"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Проверка существования файлов перед каждым тестом"""
        assert CSS_FILE.exists(), f"CSS файл не найден: {CSS_FILE}"
        assert HTML_FILE.exists(), f"HTML файл не найден: {HTML_FILE}"
    
    def test_css_file_exists(self):
        """Тест 1: Проверка существования CSS файла"""
        assert CSS_FILE.exists()
        assert CSS_FILE.stat().st_size > 0, "CSS файл пустой"
    
    def test_css_variables_defined(self):
        """Тест 2: Проверка определения CSS переменных для тем"""
        content = CSS_FILE.read_text(encoding='utf-8')
        
        required_vars = [
            '--bg-main',
            '--text-main',
            '--primary',
            '--border-color',
            '--shadow-sm',
            '--shadow-md',
            '--shadow-lg'
        ]
        
        for var in required_vars:
            assert var in content, f"CSS переменная {var} не найдена"
    
    def test_dark_theme_support(self):
        """Тест 3: Проверка поддержки темной темы"""
        content = CSS_FILE.read_text(encoding='utf-8')
        assert 'body.dark-theme' in content, "Темная тема не определена"
        assert '--bg-header' in content, "Переменная bg-header не найдена"
    
    def test_academic_style_applied(self):
        """Тест 4: Проверка применения строгого академического стиля"""
        content = CSS_FILE.read_text(encoding='utf-8')
        
        # Проверка сдержанной цветовой палитры
        assert '#2c3e50' in content or '#3498db' in content, \
            "Академическая цветовая схема не найдена"
        
        # Проверка Times New Roman для ГОСТ
        assert 'Times New Roman' in content, \
            "Шрифт Times New Roman для ГОСТ не найден"
    
    def test_responsive_design(self):
        """Тест 5: Проверка адаптивности"""
        content = CSS_FILE.read_text(encoding='utf-8')
        
        # Проверка max-width для контейнера
        assert 'max-width' in content, "Адаптивность не настроена"
        
        # Проверка flexbox
        assert 'display: flex' in content, "Flexbox не используется"
    
    def test_button_styles(self):
        """Тест 6: Проверка стилей кнопок"""
        content = CSS_FILE.read_text(encoding='utf-8')
        
        assert '.btn' in content, "Класс кнопок .btn не найден"
        assert '.btn-primary' in content, "Класс основных кнопок .btn-primary не найден"
        assert ':hover' in content, "Hover эффекты не определены"
    
    def test_modal_styles(self):
        """Тест 7: Проверка стилей модальных окон"""
        content = CSS_FILE.read_text(encoding='utf-8')
        
        assert '.modal' in content, "Класс модальных окон не найден"
        assert '.modal-content' in content, "Класс содержимого модального окна не найден"
        assert 'z-index' in content, "z-index для модальных окон не определен"
    
    def test_chat_styles(self):
        """Тест 8: Проверка стилей чата"""
        content = CSS_FILE.read_text(encoding='utf-8')
        
        assert '.chat-section' in content, "Секция чата не стилизована"
        assert '.chat-message' in content, "Сообщения чата не стилизованы"
        assert '.chat-input' in content, "Поле ввода чата не стилизовано"


class TestHTMLStructure:
    """Тесты для проверки структуры HTML"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Проверка существования HTML файла"""
        assert HTML_FILE.exists(), f"HTML файл не найден: {HTML_FILE}"
    
    def test_html_file_valid(self):
        """Тест 9: Проверка валидности HTML структуры"""
        content = HTML_FILE.read_text(encoding='utf-8')
        
        assert '<!DOCTYPE html>' in content, "DOCTYPE не объявлен"
        assert '<html' in content, "Тег html не найден"
        assert '<head>' in content, "Head секция не найдена"
        assert '<body>' in content, "Body секция не найдена"
        assert '</html>' in content, "Закрывающий тег html не найден"
    
    def test_css_linked(self):
        """Тест 10: Проверка подключения CSS файла"""
        content = HTML_FILE.read_text(encoding='utf-8')
        
        assert 'styles.css' in content, "CSS файл не подключен"
        assert '<link' in content and 'stylesheet' in content, \
            "Link тег для stylesheet не найден"
    
    def test_required_elements_present(self):
        """Тест 11: Проверка наличия обязательных элементов"""
        content = HTML_FILE.read_text(encoding='utf-8')
        
        required_elements = [
            'class="container"',
            'class="top-bar"',
            'class="editor-section"',
            'class="chat-section"',
            'id="editor"'
        ]
        
        for elem in required_elements:
            assert elem in content, f"Элемент {elem} не найден в HTML"
    
    def test_meta_tags_present(self):
        """Тест 12: Проверка мета-тегов"""
        content = HTML_FILE.read_text(encoding='utf-8')
        
        assert 'charset="UTF-8"' in content, "Кодировка UTF-8 не указана"
        assert 'viewport' in content, "Viewport meta tag не найден"


class TestJavaScriptFiles:
    """Тесты для проверки JS файлов"""
    
    def test_js_files_exist(self):
        """Тест 13: Проверка существования JS файлов"""
        js_dir = FRONTEND_DIR / "js"
        assert js_dir.exists(), f"JS директория не найдена: {js_dir}"
        
        required_files = [
            'app.js',
            'editor.js',
            'chat.js'
        ]
        
        for file in required_files:
            js_file = js_dir / file
            assert js_file.exists(), f"JS файл не найден: {js_file}"
    
    def test_js_linked_in_html(self):
        """Тест 14: Проверка подключения JS файлов в HTML"""
        content = HTML_FILE.read_text(encoding='utf-8')
        
        assert '<script' in content, "Script теги не найдены"
        assert 'app.js' in content, "app.js не подключен"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
