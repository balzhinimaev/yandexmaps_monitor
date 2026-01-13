import { promises as fs } from "fs";
import type { YandexBranch, SimpleChange } from "./yandex.js";

const BRANCHES_FILE = "./data/branches.json";

/**
 * Категории изменений с ключевыми словами для определения
 */
export const CHANGE_CATEGORIES = {
    coordinates: {
        name: "📍 Координаты/Местоположение",
        keywords: ["координат"],
        types: [] as string[],
    },
    entrances: {
        name: "🚪 Входы",
        keywords: ["вход"],
        types: [] as string[],
    },
    schedule: {
        name: "📅 График работы",
        keywords: ["график", "работы"],
        types: [] as string[],
    },
    contacts: {
        name: "📞 Контакты",
        keywords: ["телефон", "email", "почт"],
        types: [] as string[],
    },
    naming: {
        name: "🏷️ Название",
        keywords: ["назван"],
        types: [] as string[],
    },
    activities: {
        name: "📋 Виды деятельности",
        keywords: ["деятельност", "категор", "рубрик"],
        types: [] as string[],
    },
    services: {
        name: "🛠️ Услуги/Особенности",
        keywords: ["услуг", "особенност", "feature"],
        types: [] as string[],
    },
    media: {
        name: "📸 Медиа (фото/видео)",
        keywords: ["фото", "видео", "лого", "обложк", "медиа"],
        types: [] as string[],
    },
    status: {
        name: "✅ Статус",
        keywords: ["статус", "публикац", "верифик"],
        types: [] as string[],
    },
    links: {
        name: "🔗 Ссылки/Соцсети",
        keywords: ["сайт", "ссылк", "соцсет", "instagram", "vk", "telegram"],
        types: [] as string[],
    },
    address: {
        name: "📍 Адрес",
        keywords: ["адрес"],
        types: [] as string[],
    },
    description: {
        name: "📝 Описание",
        keywords: ["описан", "текст"],
        types: [] as string[],
    },
    prices: {
        name: "💰 Цены",
        keywords: ["цен", "прайс", "стоимост"],
        types: [] as string[],
    },
    other: {
        name: "❓ Прочее",
        keywords: [],
        types: [] as string[],
    },
} as const;

export type CategoryKey = keyof typeof CHANGE_CATEGORIES;

/**
 * Парсинг даты из формата "11-11-2025 · 07:52"
 */
export function parseChangeDate(dateStr: string): Date | null {
    const match = dateStr.match(/(\d{2})-(\d{2})-(\d{4})\s*·\s*(\d{2}):(\d{2})/);
    if (!match) return null;

    const [, day, month, year, hour, minute] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
}

/**
 * Определить категорию изменения по названию
 */
export function getCategoryForChangeType(changeType: string): CategoryKey {
    const lower = changeType.toLowerCase();

    // Проверяем в определённом порядке (более специфичные сначала)
    if (lower.includes("координат")) return "coordinates";
    if (lower.includes("вход")) return "entrances";
    if (lower.includes("график") || (lower.includes("работы") && !lower.includes("деятельност"))) return "schedule";
    if (lower.includes("телефон") || lower.includes("email") || lower.includes("почт")) return "contacts";
    if (lower.includes("назван")) return "naming";
    if (lower.includes("деятельност") || lower.includes("категор") || lower.includes("рубрик")) return "activities";
    if (lower.includes("услуг") || lower.includes("особенност")) return "services";
    if (lower.includes("фото") || lower.includes("видео") || lower.includes("лого") || lower.includes("обложк")) return "media";
    if (lower.includes("статус") || lower.includes("публикац")) return "status";
    if (lower.includes("сайт") || lower.includes("ссылк")) return "links";
    if (lower.includes("адрес")) return "address";
    if (lower.includes("описан") || lower.includes("текст")) return "description";
    if (lower.includes("цен") || lower.includes("прайс")) return "prices";

    return "other";
}

/**
 * Загрузка филиалов из файла
 */
export async function loadBranches(filePath: string = BRANCHES_FILE): Promise<YandexBranch[]> {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as YandexBranch[];
}

export type CategoryStats = {
    name: string;
    totalChanges: number;
    branchesAffected: number;
    changeTypes: Record<string, number>;
    recentChanges24h: number;
    recentChanges7d: number;
};

export type ChangeStats = {
    totalBranches: number;
    branchesWithChanges: number;
    branchesWithoutChanges: number;
    totalChanges: number;
    uniqueChangeTypes: number;
    averageChangesPerBranch: number;
    changesLast24h: number;
    changesLast7d: number;
    changesLast30d: number;
    branchesWithRecentChanges24h: number;
    branchesWithRecentChanges7d: number;
    changesByType: Record<string, number>;
    changesByCategory: Record<CategoryKey, CategoryStats>;
    recentChangesByType24h: Record<string, number>;
    recentChangesByType7d: Record<string, number>;
    branchesAffectedByCategory: Record<CategoryKey, number>;
};

/**
 * Анализ изменений филиалов
 */
export function analyzeChanges(branches: YandexBranch[]): ChangeStats {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Инициализация категорий
    const categoryStats: Record<CategoryKey, CategoryStats> = {} as Record<CategoryKey, CategoryStats>;
    const branchesAffectedByCategory: Record<CategoryKey, Set<string>> = {} as Record<CategoryKey, Set<string>>;

    for (const key of Object.keys(CHANGE_CATEGORIES) as CategoryKey[]) {
        categoryStats[key] = {
            name: CHANGE_CATEGORIES[key].name,
            totalChanges: 0,
            branchesAffected: 0,
            changeTypes: {},
            recentChanges24h: 0,
            recentChanges7d: 0,
        };
        branchesAffectedByCategory[key] = new Set();
    }

    const stats: ChangeStats = {
        totalBranches: branches.length,
        branchesWithChanges: 0,
        branchesWithoutChanges: 0,
        totalChanges: 0,
        uniqueChangeTypes: 0,
        averageChangesPerBranch: 0,
        changesLast24h: 0,
        changesLast7d: 0,
        changesLast30d: 0,
        branchesWithRecentChanges24h: 0,
        branchesWithRecentChanges7d: 0,
        changesByType: {},
        changesByCategory: categoryStats,
        recentChangesByType24h: {},
        recentChangesByType7d: {},
        branchesAffectedByCategory: {} as Record<CategoryKey, number>,
    };

    for (const branch of branches) {
        const changes = branch.changesHistory || [];
        const branchId = branch.id || branch.name || "unknown";

        if (changes.length > 0) {
            stats.branchesWithChanges++;
        } else {
            stats.branchesWithoutChanges++;
        }

        stats.totalChanges += changes.length;

        let hasRecentChange24h = false;
        let hasRecentChange7d = false;

        for (const change of changes) {
            const changeDate = parseChangeDate(change.date);
            const category = getCategoryForChangeType(change.title);

            // Общая группировка по типам
            if (!stats.changesByType[change.title]) {
                stats.changesByType[change.title] = 0;
            }
            stats.changesByType[change.title]++;

            // Статистика по категориям
            categoryStats[category].totalChanges++;
            if (!categoryStats[category].changeTypes[change.title]) {
                categoryStats[category].changeTypes[change.title] = 0;
            }
            categoryStats[category].changeTypes[change.title]++;
            branchesAffectedByCategory[category].add(branchId);

            if (changeDate) {
                // За последние 24 часа
                if (changeDate >= oneDayAgo) {
                    stats.changesLast24h++;
                    hasRecentChange24h = true;
                    categoryStats[category].recentChanges24h++;

                    if (!stats.recentChangesByType24h[change.title]) {
                        stats.recentChangesByType24h[change.title] = 0;
                    }
                    stats.recentChangesByType24h[change.title]++;
                }

                // За последние 7 дней
                if (changeDate >= sevenDaysAgo) {
                    stats.changesLast7d++;
                    hasRecentChange7d = true;
                    categoryStats[category].recentChanges7d++;

                    if (!stats.recentChangesByType7d[change.title]) {
                        stats.recentChangesByType7d[change.title] = 0;
                    }
                    stats.recentChangesByType7d[change.title]++;
                }

                // За последние 30 дней
                if (changeDate >= thirtyDaysAgo) {
                    stats.changesLast30d++;
                }
            }
        }

        if (hasRecentChange24h) stats.branchesWithRecentChanges24h++;
        if (hasRecentChange7d) stats.branchesWithRecentChanges7d++;
    }

    // Финализация статистики по категориям
    for (const key of Object.keys(CHANGE_CATEGORIES) as CategoryKey[]) {
        categoryStats[key].branchesAffected = branchesAffectedByCategory[key].size;
        stats.branchesAffectedByCategory[key] = branchesAffectedByCategory[key].size;
    }

    stats.uniqueChangeTypes = Object.keys(stats.changesByType).length;
    stats.averageChangesPerBranch = stats.branchesWithChanges > 0 ? Math.round((stats.totalChanges / stats.branchesWithChanges) * 100) / 100 : 0;

    return stats;
}

/**
 * Форматированный вывод статистики
 */
export function printStats(stats: ChangeStats): void {
    const line = "═".repeat(70);
    const thinLine = "─".repeat(70);

    console.log("\n" + line);
    console.log("📊 ПОДРОБНАЯ СТАТИСТИКА ИЗМЕНЕНИЙ ФИЛИАЛОВ");
    console.log(line);

    // Общая информация
    console.log("\n┌" + "─".repeat(68) + "┐");
    console.log("│ 📁 ОБЩАЯ ИНФОРМАЦИЯ" + " ".repeat(48) + "│");
    console.log("├" + "─".repeat(68) + "┤");
    console.log(`│   Всего филиалов:                    ${String(stats.totalBranches).padStart(6)}` + " ".repeat(22) + "│");
    console.log(`│   С историей изменений:              ${String(stats.branchesWithChanges).padStart(6)}` + " ".repeat(22) + "│");
    console.log(`│   Без истории изменений:             ${String(stats.branchesWithoutChanges).padStart(6)}` + " ".repeat(22) + "│");
    console.log(`│   Всего изменений:                   ${String(stats.totalChanges).padStart(6)}` + " ".repeat(22) + "│");
    console.log(`│   Уникальных типов изменений:        ${String(stats.uniqueChangeTypes).padStart(6)}` + " ".repeat(22) + "│");
    console.log(`│   Среднее изменений на филиал:       ${String(stats.averageChangesPerBranch).padStart(6)}` + " ".repeat(22) + "│");
    console.log("└" + "─".repeat(68) + "┘");

    // Изменения по периодам
    console.log("\n┌" + "─".repeat(68) + "┐");
    console.log("│ ⏱️  ИЗМЕНЕНИЯ ПО ПЕРИОДАМ" + " ".repeat(42) + "│");
    console.log("├" + "─".repeat(68) + "┤");
    console.log(
        `│   За последние 24 часа:              ${String(stats.changesLast24h).padStart(6)} изм. (${String(stats.branchesWithRecentChanges24h).padStart(3)} филиалов)` +
            " ".repeat(5) +
            "│"
    );
    console.log(
        `│   За последние 7 дней:               ${String(stats.changesLast7d).padStart(6)} изм. (${String(stats.branchesWithRecentChanges7d).padStart(3)} филиалов)` +
            " ".repeat(5) +
            "│"
    );
    console.log(`│   За последние 30 дней:              ${String(stats.changesLast30d).padStart(6)} изм.` + " ".repeat(20) + "│");
    console.log("└" + "─".repeat(68) + "┘");

    // Статистика по категориям
    console.log("\n" + line);
    console.log("📋 СТАТИСТИКА ПО КАТЕГОРИЯМ ИЗМЕНЕНИЙ");
    console.log(line);

    const categoryKeys = Object.keys(stats.changesByCategory) as CategoryKey[];
    const sortedCategories = categoryKeys
        .map((key) => ({ key, stats: stats.changesByCategory[key] }))
        .filter((c) => c.stats.totalChanges > 0)
        .sort((a, b) => b.stats.totalChanges - a.stats.totalChanges);

    for (const { key, stats: catStats } of sortedCategories) {
        const percent = ((catStats.totalChanges / stats.totalChanges) * 100).toFixed(1);
        const bar = "█".repeat(Math.min(Math.ceil(catStats.totalChanges / 30), 25));

        console.log(`\n${catStats.name}`);
        console.log(thinLine);
        console.log(`   Всего изменений: ${catStats.totalChanges} (${percent}%) ${bar}`);
        console.log(`   Затронуто филиалов: ${catStats.branchesAffected}`);
        console.log(`   За 24ч: ${catStats.recentChanges24h} | За 7д: ${catStats.recentChanges7d}`);

        // Типы изменений в категории
        const sortedTypes = Object.entries(catStats.changeTypes).sort((a, b) => b[1] - a[1]);

        console.log(`   Типы изменений (${sortedTypes.length}):`);
        for (const [type, count] of sortedTypes) {
            const typePercent = ((count / catStats.totalChanges) * 100).toFixed(0);
            console.log(`      • ${type}: ${count} (${typePercent}%)`);
        }
    }

    // Все уникальные типы изменений (полный список)
    console.log("\n" + line);
    console.log("📝 ВСЕ УНИКАЛЬНЫЕ ТИПЫ ИЗМЕНЕНИЙ (по частоте)");
    console.log(line);

    const allTypes = Object.entries(stats.changesByType).sort((a, b) => b[1] - a[1]);

    console.log(`\n${"№".padStart(3)}  ${"Тип изменения".padEnd(45)} ${"Кол-во".padStart(6)}  ${"Категория".padEnd(20)}`);
    console.log(thinLine);

    allTypes.forEach(([type, count], idx) => {
        const category = getCategoryForChangeType(type);
        const catName = CHANGE_CATEGORIES[category].name.replace(/^[^\s]+\s/, ""); // убираем emoji
        const num = String(idx + 1).padStart(3);
        const typeStr = type.length > 45 ? type.slice(0, 42) + "..." : type.padEnd(45);
        console.log(`${num}. ${typeStr} ${String(count).padStart(6)}  ${catName}`);
    });

    // Недавние изменения
    if (Object.keys(stats.recentChangesByType24h).length > 0) {
        console.log("\n" + line);
        console.log("🔥 ИЗМЕНЕНИЯ ЗА ПОСЛЕДНИЕ 24 ЧАСА (по типам)");
        console.log(line);

        const sortedRecent = Object.entries(stats.recentChangesByType24h).sort((a, b) => b[1] - a[1]);

        for (const [type, count] of sortedRecent) {
            const category = getCategoryForChangeType(type);
            const catName = CHANGE_CATEGORIES[category].name;
            console.log(`   ${type}: ${count} ${catName}`);
        }
    }

    if (Object.keys(stats.recentChangesByType7d).length > 0) {
        console.log("\n" + line);
        console.log("📅 ИЗМЕНЕНИЯ ЗА ПОСЛЕДНИЕ 7 ДНЕЙ (по типам)");
        console.log(line);

        const sortedRecent7d = Object.entries(stats.recentChangesByType7d).sort((a, b) => b[1] - a[1]);

        for (const [type, count] of sortedRecent7d) {
            const category = getCategoryForChangeType(type);
            const catName = CHANGE_CATEGORIES[category].name;
            console.log(`   ${type}: ${count} ${catName}`);
        }
    }

    console.log("\n" + line);
}

/**
 * Получить филиалы с изменениями за последние N часов
 */
export function getBranchesWithRecentChanges(branches: YandexBranch[], hoursAgo: number = 24): { branch: YandexBranch; recentChanges: SimpleChange[] }[] {
    const now = new Date();
    const cutoff = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
    const result: { branch: YandexBranch; recentChanges: SimpleChange[] }[] = [];

    for (const branch of branches) {
        const changes = branch.changesHistory || [];
        const recentChanges = changes.filter((c) => {
            const date = parseChangeDate(c.date);
            return date && date >= cutoff;
        });

        if (recentChanges.length > 0) {
            result.push({ branch, recentChanges });
        }
    }

    return result;
}

/**
 * Получить филиалы с определённым типом изменения
 */
export function getBranchesByChangeType(branches: YandexBranch[], changeType: string): YandexBranch[] {
    const typeLower = changeType.toLowerCase();
    return branches.filter((branch) => (branch.changesHistory || []).some((c) => c.title.toLowerCase().includes(typeLower)));
}

/**
 * Получить филиалы по категории изменений
 */
export function getBranchesByCategory(branches: YandexBranch[], category: CategoryKey): YandexBranch[] {
    return branches.filter((branch) => (branch.changesHistory || []).some((c) => getCategoryForChangeType(c.title) === category));
}

/**
 * Главная функция для запуска анализа
 */
export async function runAnalysis(filePath?: string): Promise<ChangeStats> {
    console.log("📂 Загружаем данные филиалов...");
    const branches = await loadBranches(filePath);
    console.log(`   Загружено ${branches.length} филиалов`);

    const stats = analyzeChanges(branches);
    printStats(stats);

    // Дополнительно: выводим филиалы с недавними изменениями
    const recentBranches = getBranchesWithRecentChanges(branches, 24);
    if (recentBranches.length > 0) {
        console.log(`\n📍 ФИЛИАЛЫ С ИЗМЕНЕНИЯМИ ЗА ПОСЛЕДНИЕ 24 ЧАСА (${recentBranches.length}):`);
        console.log("─".repeat(70));

        for (const { branch, recentChanges } of recentBranches.slice(0, 15)) {
            const shortAddr = branch.address ? branch.address.slice(0, 55) + "..." : "";
            console.log(`\n   🏪 ${branch.name}`);
            console.log(`      ${shortAddr}`);
            for (const change of recentChanges) {
                const category = getCategoryForChangeType(change.title);
                const emoji = CHANGE_CATEGORIES[category].name.split(" ")[0];
                console.log(`      ${emoji} ${change.title} — ${change.date}`);
            }
        }
        if (recentBranches.length > 15) {
            console.log(`\n   ... и ещё ${recentBranches.length - 15} филиалов`);
        }
    }

    return stats;
}

// Запуск если вызван напрямую
const isDirectRun = (() => {
    const argvPath = process.argv[1];
    if (!argvPath) return false;
    const normalizedArgvPath = argvPath.replace(/\\/g, "/");
    return import.meta.url === `file://${normalizedArgvPath}` || import.meta.url.endsWith(normalizedArgvPath);
})();

if (isDirectRun) {
    runAnalysis()
        .then(() => {
            process.exit(0);
        })
        .catch((err) => {
            console.error("❌ Ошибка:", err.message);
            process.exit(1);
        });
}
