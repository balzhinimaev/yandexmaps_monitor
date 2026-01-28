import { promises as fs } from "fs";
import puppeteer from "puppeteer";
import type { YandexBranch, SimpleChange } from "./yandex.js";
import { sendMessage } from "./telegram.js";

// Парсер аргументов командной строки
function parseArgs() {
    const args = process.argv.slice(2);
    const options: { pdf?: string; file?: string; telegram?: boolean } = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--pdf" || arg === "-p") {
            options.pdf = args[i + 1] || "./analysis-report.pdf";
            i++; // Пропускаем следующий аргумент
        } else if (arg === "--file" || arg === "-f") {
            options.file = args[i + 1];
            i++;
        } else if (arg === "--telegram" || arg === "-t") {
            options.telegram = true;
        } else if (!arg.startsWith("-")) {
            // Если аргумент не начинается с -, считаем его путем к файлу
            options.file = arg;
        }
    }

    return options;
}

/**
 * Отправка сводки анализа в Telegram
 */
export async function sendAnalysisSummary(stats: ChangeStats): Promise<void> {
    const lines = [
        `📊 *Статистика изменений филиалов*`,
        ``,
        `📁 Всего филиалов: ${stats.totalBranches}`,
        `📝 Всего изменений: ${stats.totalChanges}`,
        ``,
        `⏱️ *По периодам:*`,
        `   За 24ч: ${stats.changesLast24h} (${stats.branchesWithRecentChanges24h} филиалов)`,
        `   За 7д: ${stats.changesLast7d} (${stats.branchesWithRecentChanges7d} филиалов)`,
        `   За 30д: ${stats.changesLast30d}`,
    ];

    // Топ-5 категорий
    const categoryKeys = Object.keys(stats.changesByCategory) as CategoryKey[];
    const sortedCategories = categoryKeys
        .map((key) => ({ key, catStats: stats.changesByCategory[key] }))
        .filter((c) => c.catStats.totalChanges > 0)
        .sort((a, b) => b.catStats.totalChanges - a.catStats.totalChanges)
        .slice(0, 5);

    if (sortedCategories.length > 0) {
        lines.push(``);
        lines.push(`📋 *Топ категорий:*`);
        for (const { catStats } of sortedCategories) {
            const percent = ((catStats.totalChanges / stats.totalChanges) * 100).toFixed(0);
            lines.push(`   ${catStats.name}: ${catStats.totalChanges} (${percent}%)`);
        }
    }

    const message = lines.join("\n");
    await sendMessage(message);
}

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
 * Генерация PDF отчета со статистикой
 */
/**
 * Генерация PDF отчета со статистикой с использованием Puppeteer
 */
export async function generatePDFReport(stats: ChangeStats, branches: YandexBranch[], outputPath: string = "./analysis-report.pdf"): Promise<void> {
    // Создаем HTML шаблон для отчета
    const htmlContent = generateHTMLReport(stats, branches);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: "networkidle0" });

        // Генерируем PDF
        await page.pdf({
            path: outputPath,
            format: "A4",
            printBackground: true,
            margin: {
                top: "20mm",
                right: "20mm",
                bottom: "20mm",
                left: "20mm",
            },
        });

        console.log(`📄 PDF отчет сохранен: ${outputPath}`);
    } catch (error) {
        console.error("❌ Ошибка генерации PDF:", error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Генерация HTML шаблона для PDF отчета
 */
function generateHTMLReport(stats: ChangeStats, branches: YandexBranch[]): string {
    const categoryKeys = Object.keys(stats.changesByCategory) as CategoryKey[];
    const sortedCategories = categoryKeys
        .map((key) => ({ key, stats: stats.changesByCategory[key] }))
        .filter((c) => c.stats.totalChanges > 0)
        .sort((a, b) => b.stats.totalChanges - a.stats.totalChanges);

    const allTypes = Object.entries(stats.changesByType).sort((a, b) => b[1] - a[1]);

    // Генерируем HTML для категорий
    const categoriesHTML = sortedCategories
        .map(({ key, stats: catStats }) => {
            const percent = ((catStats.totalChanges / stats.totalChanges) * 100).toFixed(1);
            const sortedTypes = Object.entries(catStats.changeTypes).sort((a, b) => b[1] - a[1]);

            const typesHTML = sortedTypes
                .slice(0, 8)
                .map(([type, count]) => {
                    const typePercent = ((count / catStats.totalChanges) * 100).toFixed(0);
                    return `<div>• ${type}: ${count} (${typePercent}%)</div>`;
                })
                .join("");

            const moreTypes = sortedTypes.length > 8 ? `<div>... и ещё ${sortedTypes.length - 8} типов</div>` : "";

            return `
            <div class="category">
                <div class="category-title">${catStats.name}</div>
                <div class="category-stats">
                    <div>Всего изменений: ${catStats.totalChanges} (${percent}%)</div>
                    <div>Затронуто филиалов: ${catStats.branchesAffected}</div>
                    <div>За 24ч: ${catStats.recentChanges24h} | За 7д: ${catStats.recentChanges7d}</div>
                </div>
                <div class="category-types">
                    <div>Типы изменений (${sortedTypes.length}):</div>
                    ${typesHTML}
                    ${moreTypes}
                </div>
            </div>
        `;
        })
        .join("");

    // Генерируем HTML для таблицы всех типов изменений
    const typesTableHTML = allTypes
        .slice(0, 50)
        .map(([type, count], i) => {
            const category = getCategoryForChangeType(type);
            const catName = CHANGE_CATEGORIES[category].name.replace(/^[^\s]+\s/, "");
            const num = String(i + 1).padStart(2);
            const typeStr = type.length > 25 ? type.slice(0, 22) + "..." : type;

            return `
            <tr>
                <td>${num}</td>
                <td>${typeStr}</td>
                <td>${count}</td>
                <td>${catName}</td>
            </tr>
        `;
        })
        .join("");

    const moreTypesText = allTypes.length > 50 ? `<div class="more-types">... и ещё ${allTypes.length - 50} типов изменений</div>` : "";

    // Генерируем HTML для недавних изменений
    let recentChangesHTML = "";

    if (Object.keys(stats.recentChangesByType24h).length > 0) {
        const sortedRecent = Object.entries(stats.recentChangesByType24h).sort((a, b) => b[1] - a[1]);
        const recent24HTML = sortedRecent
            .slice(0, 15)
            .map(([type, count]) => {
                const category = getCategoryForChangeType(type);
                const catName = CHANGE_CATEGORIES[category].name;
                return `<div>${type}: ${count} ${catName}</div>`;
            })
            .join("");

        recentChangesHTML += `
            <div class="section">
                <h3>Изменения за последние 24 часа</h3>
                <div class="recent-changes">
                    ${recent24HTML}
                </div>
            </div>
        `;
    }

    if (Object.keys(stats.recentChangesByType7d).length > 0) {
        const sortedRecent7d = Object.entries(stats.recentChangesByType7d).sort((a, b) => b[1] - a[1]);
        const recent7HTML = sortedRecent7d
            .slice(0, 15)
            .map(([type, count]) => {
                const category = getCategoryForChangeType(type);
                const catName = CHANGE_CATEGORIES[category].name;
                return `<div>${type}: ${count} ${catName}</div>`;
            })
            .join("");

        recentChangesHTML += `
            <div class="section">
                <h3>Изменения за последние 7 дней</h3>
                <div class="recent-changes">
                    ${recent7HTML}
                </div>
            </div>
        `;
    }

    // Генерируем HTML для списка филиалов с изменениями
    const branchesWithChanges = branches
        .filter((b) => b.changesHistory && b.changesHistory.length > 0)
        .sort((a, b) => {
            // Сортируем по дате последнего изменения (сначала самые свежие)
            const dateA = a.changesHistory?.[0]?.date || "";
            const dateB = b.changesHistory?.[0]?.date || "";
            const parsedA = parseChangeDate(dateA);
            const parsedB = parseChangeDate(dateB);
            if (!parsedA && !parsedB) return 0;
            if (!parsedA) return 1;
            if (!parsedB) return -1;
            return parsedB.getTime() - parsedA.getTime();
        });

    const branchesListHTML = branchesWithChanges
        .map((branch, idx) => {
            const changes = branch.changesHistory || [];
            const recentChanges = changes.slice(0, 5); // Показываем до 5 последних изменений

            const changesHTML = recentChanges
                .map((change) => {
                    const category = getCategoryForChangeType(change.title);
                    const emoji = CHANGE_CATEGORIES[category].name.split(" ")[0];
                    return `<div class="branch-change">${emoji} ${change.title} — <span class="change-date">${change.date}</span></div>`;
                })
                .join("");

            const moreChanges = changes.length > 5 ? `<div class="branch-more">... и ещё ${changes.length - 5} изменений</div>` : "";

            const changesUrl = branch.changesUrl || "";
            const linkHTML = changesUrl ? `<a href="${changesUrl}" class="branch-link" target="_blank">Открыть страницу изменений →</a>` : "";

            const address = branch.address ? `<div class="branch-address">${branch.address}</div>` : "";

            return `
                <div class="branch-item">
                    <div class="branch-header">
                        <span class="branch-num">${idx + 1}.</span>
                        <span class="branch-name">${branch.name || "Без названия"}</span>
                        <span class="branch-changes-count">(${changes.length} изм.)</span>
                    </div>
                    ${address}
                    ${linkHTML}
                    <div class="branch-changes-list">
                        ${changesHTML}
                        ${moreChanges}
                    </div>
                </div>
            `;
        })
        .join("");

    return `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Статистика изменений филиалов</title>
            <style>
                body {
                    font-family: 'Arial', 'Helvetica', sans-serif;
                    line-height: 1.6;
                    color: #333;
                    margin: 0;
                    padding: 20px;
                    background: white;
                }

                .header {
                    text-align: center;
                    border-bottom: 2px solid #2980b9;
                    padding-bottom: 20px;
                    margin-bottom: 30px;
                }

                .header h1 {
                    color: #2980b9;
                    margin: 0 0 10px 0;
                    font-size: 24px;
                }

                .header .date {
                    color: #7f8c8d;
                    font-size: 14px;
                }

                .section {
                    margin-bottom: 30px;
                }

                .section h2 {
                    color: #2980b9;
                    border-bottom: 1px solid #2980b9;
                    padding-bottom: 5px;
                    margin-bottom: 15px;
                    font-size: 18px;
                }

                .section h3 {
                    color: #e67e22;
                    margin-bottom: 10px;
                    font-size: 16px;
                }

                .info-list {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 5px;
                    border-left: 4px solid #2980b9;
                }

                .info-list div {
                    margin-bottom: 5px;
                }

                .categories {
                    display: grid;
                    gap: 20px;
                }

                .category {
                    border: 1px solid #ddd;
                    border-radius: 5px;
                    padding: 15px;
                    background: #f8f9fa;
                }

                .category-title {
                    font-weight: bold;
                    color: #2980b9;
                    font-size: 16px;
                    margin-bottom: 10px;
                }

                .category-stats {
                    margin-bottom: 10px;
                }

                .category-stats div {
                    margin-bottom: 3px;
                    font-size: 14px;
                }

                .category-types {
                    font-size: 14px;
                }

                .category-types div {
                    margin-bottom: 2px;
                }

                .types-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 15px;
                }

                .types-table th,
                .types-table td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                    font-size: 12px;
                }

                .types-table th {
                    background: #2980b9;
                    color: white;
                    font-weight: bold;
                }

                .types-table tr:nth-child(even) {
                    background: #f8f9fa;
                }

                .recent-changes {
                    background: #fff3cd;
                    padding: 10px;
                    border-radius: 5px;
                    border-left: 4px solid #e67e22;
                }

                .recent-changes div {
                    margin-bottom: 3px;
                    font-size: 14px;
                }

                .more-types {
                    font-style: italic;
                    color: #7f8c8d;
                    margin-top: 10px;
                }

                .footer {
                    text-align: center;
                    margin-top: 40px;
                    padding-top: 20px;
                    border-top: 1px solid #ddd;
                    color: #7f8c8d;
                    font-size: 12px;
                    font-style: italic;
                }

                .branches-list {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }

                .branch-item {
                    border: 1px solid #ddd;
                    border-radius: 5px;
                    padding: 12px;
                    background: #fafafa;
                    page-break-inside: avoid;
                }

                .branch-header {
                    display: flex;
                    align-items: baseline;
                    gap: 8px;
                    margin-bottom: 5px;
                }

                .branch-num {
                    color: #7f8c8d;
                    font-weight: bold;
                    min-width: 30px;
                }

                .branch-name {
                    font-weight: bold;
                    color: #2c3e50;
                    font-size: 14px;
                }

                .branch-changes-count {
                    color: #7f8c8d;
                    font-size: 12px;
                }

                .branch-address {
                    color: #666;
                    font-size: 12px;
                    margin-bottom: 5px;
                    padding-left: 38px;
                }

                .branch-link {
                    display: inline-block;
                    color: #2980b9;
                    font-size: 12px;
                    text-decoration: none;
                    margin-bottom: 8px;
                    padding-left: 38px;
                }

                .branch-link:hover {
                    text-decoration: underline;
                }

                .branch-changes-list {
                    padding-left: 38px;
                    border-left: 3px solid #e0e0e0;
                    margin-left: 15px;
                }

                .branch-change {
                    font-size: 12px;
                    color: #444;
                    margin-bottom: 3px;
                }

                .change-date {
                    color: #7f8c8d;
                    font-size: 11px;
                }

                .branch-more {
                    font-style: italic;
                    color: #7f8c8d;
                    font-size: 11px;
                    margin-top: 3px;
                }

                @media print {
                    body {
                        font-size: 12px;
                    }

                    .category {
                        break-inside: avoid;
                    }

                    .branch-item {
                        break-inside: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Подробная статистика изменений филиалов</h1>
                <div class="date">Отчет создан: ${new Date().toLocaleString("ru-RU")}</div>
            </div>

            <div class="section">
                <h2>Общая информация</h2>
                <div class="info-list">
                    <div>Всего филиалов: ${stats.totalBranches}</div>
                    <div>С историей изменений: ${stats.branchesWithChanges}</div>
                    <div>Без истории изменений: ${stats.branchesWithoutChanges}</div>
                    <div>Всего изменений: ${stats.totalChanges}</div>
                    <div>Уникальных типов изменений: ${stats.uniqueChangeTypes}</div>
                    <div>Среднее изменений на филиал: ${stats.averageChangesPerBranch}</div>
                </div>
            </div>

            <div class="section">
                <h2>Изменения по периодам</h2>
                <div class="info-list">
                    <div>За последние 24 часа: ${stats.changesLast24h} изменений (${stats.branchesWithRecentChanges24h} филиалов)</div>
                    <div>За последние 7 дней: ${stats.changesLast7d} изменений (${stats.branchesWithRecentChanges7d} филиалов)</div>
                    <div>За последние 30 дней: ${stats.changesLast30d} изменений</div>
                </div>
            </div>

            <div class="section">
                <h2 style="text-align: center;">Статистика по категориям изменений</h2>
                <div class="categories">
                    ${categoriesHTML}
                </div>
            </div>

            <div class="section">
                <h2 style="text-align: center;">Все уникальные типы изменений (по частоте)</h2>
                <table class="types-table">
                    <thead>
                        <tr>
                            <th>№</th>
                            <th>Тип изменения</th>
                            <th>Кол-во</th>
                            <th>Категория</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${typesTableHTML}
                    </tbody>
                </table>
                ${moreTypesText}
            </div>

            ${recentChangesHTML}

            <div class="section">
                <h2 style="text-align: center;">Список филиалов с изменениями (${branchesWithChanges.length})</h2>
                <div class="branches-list">
                    ${branchesListHTML}
                </div>
            </div>

            <div class="footer">
                Сгенерировано с помощью Yandex Maps Monitor
            </div>
        </body>
        </html>
    `;
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
export async function runAnalysis(filePath?: string, options?: { pdf?: string; telegram?: boolean }): Promise<ChangeStats> {
    console.log("📂 Загружаем данные филиалов...");
    const branches = await loadBranches(filePath);
    console.log(`   Загружено ${branches.length} филиалов`);

    const stats = analyzeChanges(branches);
    printStats(stats);

    // Генерация PDF если указан путь
    if (options?.pdf) {
        console.log("\n📄 Генерируем PDF отчет...");
        await generatePDFReport(stats, branches, options.pdf);
    }

    // Отправка в Telegram если указан флаг
    if (options?.telegram) {
        console.log("\n📤 Отправляем сводку в Telegram...");
        await sendAnalysisSummary(stats);
        console.log("✅ Сводка отправлена!");
    }

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
    const options = parseArgs();
    runAnalysis(options.file, { pdf: options.pdf, telegram: options.telegram })
        .then(() => {
            process.exit(0);
        })
        .catch((err) => {
            console.error("❌ Ошибка:", err.message);
            process.exit(1);
        });
}
