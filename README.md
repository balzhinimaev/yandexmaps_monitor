# Yandex Maps Monitor Bot

Бот для мониторинга данных на Яндекс.Картах. Автоматически проверяет соответствие информации из XML-файла с данными на Яндекс.Картах и отправляет уведомления в Telegram.

## Возможности

- 🔍 Автоматический поиск организаций на Яндекс.Картах
- 📊 Сравнение расписаний работы и адресов
- 📱 Отправка уведомлений в Telegram
- ⏰ Настраиваемое расписание проверок (cron)
- 🐳 Docker поддержка для простого развертывания
- 💾 Кэширование результатов между проверками

## Требования

- Node.js 20+
- npm или yarn
- Docker и Docker Compose (опционально)

## Установка

### Локальная установка

1. Клонируйте репозиторий:
```bash
git clone <repository-url>
cd yandex
```

2. Установите зависимости:
```bash
npm install
```

3. Создайте файл `.env` на основе `.env.example`:
```bash
cp .env.example .env
```

4. Заполните переменные окружения в `.env`

### Docker установка

1. Создайте `.env` файл с необходимыми переменными
2. Запустите контейнер:
```bash
docker-compose up -d
```

## Конфигурация

### Переменные окружения

| Переменная | Описание | Пример |
|-----------|----------|--------|
| `TELEGRAM_BOT_TOKEN` | Токен Telegram бота | `123456789:ABCdefGHIjklMNOpqrsTUVwxyz` |
| `TELEGRAM_CHAT_ID` | ID чата для уведомлений | `-1001234567890` |
| `YANDEX_API_KEY` | API ключ Яндекс.Карт | `your_api_key` |
| `YMAPS_LANG` | Язык API Яндекс.Карт | `ru_RU` |
| `YMAPS_RESULTS` | Макс. результатов поиска | `50` |
| `MAX_DISTANCE_METERS` | Макс. расстояние для совпадения (м) | `500` |
| `SCHEDULE_TOLERANCE_MIN` | Допустимое отклонение расписания (мин) | `30` |
| `HTTP_TIMEOUT_MS` | Таймаут HTTP запросов (мс) | `30000` |
| `CRON_SCHEDULE` | Cron расписание проверок | `0 9 * * *` |
| `TZ` | Часовой пояс | `Europe/Moscow` |

## Использование

### Разработка

```bash
# Запуск в режиме разработки с hot-reload
npm run dev

# Проверка типов
npm run type-check

# Линтинг
npm run lint
npm run lint:fix

# Форматирование кода
npm run format
npm run format:check
```

### Продакшн

```bash
# Сборка проекта
npm run build

# Запуск
npm start

# Одноразовый запуск (без cron)
npm run run:once
```

### Docker

```bash
# Сборка и запуск
docker-compose up -d

# Просмотр логов
docker-compose logs -f

# Остановка
docker-compose down

# Пересборка после изменений
docker-compose up -d --build
```

## Структура проекта

```
.
├── src/
│   ├── cache.ts      # Кэширование результатов
│   ├── compare.ts    # Сравнение данных
│   ├── config.ts     # Конфигурация и валидация env
│   ├── index.ts      # Точка входа, планировщик
│   ├── normalize.ts  # Нормализация строк
│   ├── report.ts     # Формирование отчетов
│   ├── run.ts        # Основная логика проверки
│   ├── telegram.ts   # Интеграция с Telegram
│   ├── xml.ts        # Парсинг XML
│   └── yandex.ts     # API Яндекс.Карт
├── data/             # Данные и кэш (создается автоматически)
├── dist/             # Скомпилированный код
├── .env              # Переменные окружения (не в git)
├── .env.example      # Пример конфигурации
├── Dockerfile        # Docker образ
├── docker-compose.yml # Docker Compose конфигурация
└── package.json      # Зависимости и скрипты
```

## Разработка

### Код-стайл

Проект использует:
- **ESLint** для проверки кода
- **Prettier** для форматирования
- **EditorConfig** для консистентности

Перед коммитом рекомендуется запустить:
```bash
npm run format
npm run lint:fix
npm run type-check
```

### Docker оптимизации

Dockerfile использует:
- Multi-stage build для минимального размера образа
- Кэширование слоев для быстрой пересборки
- Non-root пользователь для безопасности
- Health checks для мониторинга

## Лицензия

MIT

## Поддержка

Для вопросов и предложений создавайте Issue в репозитории.

