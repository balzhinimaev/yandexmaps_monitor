/**
 * Скрипт для извлечения всех уникальных типов изменений из branches.json
 */

import { promises as fs } from "fs";
import type { YandexBranch } from "./yandex.js";

const BRANCHES_FILE = "./data/branches.json";

async function extractAllChangeTypes() {
    console.log("📂 Загружаем данные филиалов...");
    const content = await fs.readFile(BRANCHES_FILE, "utf8");
    const branches: YandexBranch[] = JSON.parse(content);
    console.log(`   Загружено ${branches.length} филиалов\n`);

    // Собираем все уникальные типы
    const changeTypes = new Map<string, number>();
    let totalChanges = 0;

    for (const branch of branches) {
        const changes = branch.changesHistory || [];
        for (const change of changes) {
            totalChanges++;
            const count = changeTypes.get(change.title) || 0;
            changeTypes.set(change.title, count + 1);
        }
    }

    // Сортируем по количеству
    const sorted = Array.from(changeTypes.entries()).sort((a, b) => b[1] - a[1]);

    console.log("=".repeat(70));
    console.log("📋 ВСЕ УНИКАЛЬНЫЕ ТИПЫ ИЗМЕНЕНИЙ");
    console.log("=".repeat(70));
    console.log(`\nВсего уникальных типов: ${sorted.length}`);
    console.log(`Всего изменений: ${totalChanges}\n`);

    console.log("─".repeat(70));
    console.log("№".padStart(3) + "  " + "Тип изменения".padEnd(50) + "Кол-во");
    console.log("─".repeat(70));

    sorted.forEach(([type, count], idx) => {
        const num = String(idx + 1).padStart(3);
        const typeStr = type.padEnd(50);
        console.log(`${num}. ${typeStr} ${count}`);
    });

    console.log("─".repeat(70));

    // Группировка по категориям (эвристика)
    console.log("\n📊 ГРУППИРОВКА ПО КАТЕГОРИЯМ:\n");

    const categories: Record<string, string[]> = {
        "📍 Координаты/Местоположение": [],
        "🚪 Входы": [],
        "📅 График работы": [],
        "📞 Контакты": [],
        "🏷️ Название": [],
        "📋 Виды деятельности": [],
        "🛠️ Услуги/Особенности": [],
        "📸 Медиа (фото/видео)": [],
        "✅ Статус": [],
        "🔗 Ссылки/Соцсети": [],
        "📝 Описание": [],
        "💰 Цены": [],
        "❓ Прочее": [],
    };

    for (const [type] of sorted) {
        const lower = type.toLowerCase();

        if (lower.includes("координат")) {
            categories["📍 Координаты/Местоположение"].push(type);
        } else if (lower.includes("вход")) {
            categories["🚪 Входы"].push(type);
        } else if (lower.includes("график") || lower.includes("работы")) {
            categories["📅 График работы"].push(type);
        } else if (lower.includes("телефон") || lower.includes("email") || lower.includes("почт")) {
            categories["📞 Контакты"].push(type);
        } else if (lower.includes("назван")) {
            categories["🏷️ Название"].push(type);
        } else if (lower.includes("деятельност") || lower.includes("категор") || lower.includes("рубрик")) {
            categories["📋 Виды деятельности"].push(type);
        } else if (lower.includes("услуг") || lower.includes("особенност") || lower.includes("feature")) {
            categories["🛠️ Услуги/Особенности"].push(type);
        } else if (lower.includes("фото") || lower.includes("видео") || lower.includes("лого") || lower.includes("обложк") || lower.includes("медиа")) {
            categories["📸 Медиа (фото/видео)"].push(type);
        } else if (lower.includes("статус") || lower.includes("публикац") || lower.includes("верифик")) {
            categories["✅ Статус"].push(type);
        } else if (
            lower.includes("сайт") ||
            lower.includes("ссылк") ||
            lower.includes("соцсет") ||
            lower.includes("instagram") ||
            lower.includes("vk") ||
            lower.includes("telegram")
        ) {
            categories["🔗 Ссылки/Соцсети"].push(type);
        } else if (lower.includes("описан") || lower.includes("текст")) {
            categories["📝 Описание"].push(type);
        } else if (lower.includes("цен") || lower.includes("прайс") || lower.includes("стоимост")) {
            categories["💰 Цены"].push(type);
        } else {
            categories["❓ Прочее"].push(type);
        }
    }

    for (const [category, types] of Object.entries(categories)) {
        if (types.length > 0) {
            console.log(`${category}:`);
            types.forEach((t) => {
                const count = changeTypes.get(t) || 0;
                console.log(`   • ${t} (${count})`);
            });
            console.log();
        }
    }

    // Выводим как массив для использования в коде
    console.log("=".repeat(70));
    console.log("💻 МАССИВ ВСЕХ ТИПОВ (для использования в коде):");
    console.log("=".repeat(70));
    console.log("\nconst CHANGE_TYPES = [");
    sorted.forEach(([type]) => {
        console.log(`    "${type}",`);
    });
    console.log("];");
}

extractAllChangeTypes().catch((err) => {
    console.error("❌ Ошибка:", err.message);
    process.exit(1);
});
