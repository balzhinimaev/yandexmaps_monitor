# Исправления и решения проблем

## Ошибка `__name is not defined` при использовании tsx

### Проблема
При запуске скриптов через `tsx` возникала ошибка:
```
ReferenceError: __name is not defined
    at eval (eval at evaluate (:290:30), <anonymous>:1:99)
```

### Причина
`tsx` компилирует TypeScript на лету и добавляет helper-функции (включая `__name`) при компиляции. Когда функции с типами используются внутри `page.evaluate()` в Playwright, эти helper-функции попадают в браузерный контекст, где они не определены.

### Решение
1. **Убраны все TypeScript типы** из функций внутри `page.evaluate()`:
   - Заменили `(timeStr: string): Date | null =>` на `(timeStr) =>`
   - Добавили `@ts-ignore` перед проблемными функциями

2. **Изменены npm скрипты** для использования скомпилированного JavaScript вместо tsx:
   ```json
   "check:recent": "npm run build && node dist/check-recent-changes.js",
   "fetch:changes": "npm run build && node dist/fetch-changes.js"
   ```

3. **Обновлен tsconfig.json**:
   - `target: "ES2020"` - для нативной поддержки optional chaining
   - Это избавило от лишних helper-функций при компиляции

### Запуск
Теперь команды работают корректно:
```bash
npm run check:recent   # Проверка изменений за 24 часа
npm run fetch:changes  # Сбор полной истории изменений
```

## Graceful Shutdown

Добавлена корректная обработка прерывания (Ctrl+C):
- Браузер закрывается корректно
- Данные сохраняются до завершения
- Нет cascading ошибок

