/**
 * Тестовый скрипт для проверки работоспособности отправки в Telegram
 *
 * Запуск: npm run test:telegram
 */

import { sendMessage, sendChunks, bot } from "./telegram.js";
import { reportAllOk, reportDiffs } from "./report.js";
import { env, CHAT_ID } from "./config.js";

type TestResult = {
    name: string;
    success: boolean;
    error?: string;
};

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        results.push({ name, success: true });
        console.log(`✅ ${name}`);
    } catch (e: any) {
        results.push({ name, success: false, error: e?.message || String(e) });
        console.log(`❌ ${name}: ${e?.message || e}`);
    }
}

async function runTests() {
    console.log("🧪 Тестирование Telegram отправки\n");
    console.log("=".repeat(50));

    // Тест 1: Проверка конфигурации
    await test("Проверка TELEGRAM_BOT_TOKEN", async () => {
        if (!env.TELEGRAM_BOT_TOKEN) {
            throw new Error("TELEGRAM_BOT_TOKEN не задан в .env");
        }
    });

    await test("Проверка TELEGRAM_CHAT_ID", async () => {
        if (!CHAT_ID) {
            throw new Error("TELEGRAM_CHAT_ID не задан в .env");
        }
    });

    await test("Проверка инициализации бота", async () => {
        if (!bot) {
            throw new Error("Бот не инициализирован (проверьте TELEGRAM_BOT_TOKEN)");
        }
    });

    // Тест 2: Отправка простого сообщения
    await test("Отправка простого сообщения", async () => {
        await sendMessage("🧪 Тест: простое сообщение от yandex-maps-monitor");
    });

    // Тест 3: Отправка reportAllOk
    await test("Отправка reportAllOk (все точки в порядке)", async () => {
        await reportAllOk(42);
    });

    // Тест 4: Отправка reportDiffs с тестовыми данными
    await test("Отправка reportDiffs (тестовые расхождения)", async () => {
        const testDiffs = [
            {
                companyId: "TEST-001",
                name: "Тестовая компания 1",
                address: "г. Москва, ул. Тестовая, д. 1",
                expected: "круглосуточно",
                actual: "09:00-21:00",
                url: "https://yandex.ru/maps/org/test/123456789",
            },
            {
                companyId: "TEST-002",
                name: "Тестовая компания 2",
                address: "г. Москва, ул. Примерная, д. 2",
                expected: "ежедневно 10:00-22:00",
                actual: "10:00-20:00",
            },
        ];
        await reportDiffs(testDiffs);
    });

    // Тест 5: Отправка длинного сообщения (проверка chunking)
    await test("Отправка длинного сообщения (chunking)", async () => {
        const longBody = Array(50)
            .fill(null)
            .map((_, i) => `Строка ${i + 1}: ${"x".repeat(50)}`)
            .join("\n");
        await sendChunks("🧪 Тест: длинное сообщение", longBody);
    });

    // Итоги
    console.log("\n" + "=".repeat(50));
    console.log("📊 Итоги тестирования:\n");

    const passed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`   Успешно: ${passed}`);
    console.log(`   Провалено: ${failed}`);
    console.log(`   Всего: ${results.length}`);

    if (failed > 0) {
        console.log("\n❌ Провалившиеся тесты:");
        results
            .filter((r) => !r.success)
            .forEach((r) => {
                console.log(`   - ${r.name}: ${r.error}`);
            });
        process.exitCode = 1;
    } else {
        console.log("\n✅ Все тесты пройдены! Telegram отправка работает корректно.");
    }
}

// Запуск
runTests().catch((e) => {
    console.error("Критическая ошибка:", e);
    process.exitCode = 1;
});
