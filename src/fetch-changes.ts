// src/fetch-changes.ts
// Скрипт для сбора истории изменений всех филиалов

import { promises as fs } from "fs";
import { ensureYandexAuth, closeBrowser, fetchBranchChangeHistory, type YandexBranch, type BranchChangeHistory } from "./yandex.js";
import { sendMessage } from "./telegram.js";
import pLimit from "p-limit";

const BRANCHES_FILE = "./data/branches.json";
const CHANGES_OUTPUT_FILE = "./data/branches-changes.json";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Ограничиваем количество одновременных запросов
const limit = pLimit(3);

function parseTimestamp(timestamp: string): Date | null {
    const match = timestamp.match(/(\d{2})-(\d{2})-(\d{4})\s*·\s*(\d{2}):(\d{2})/);
    if (!match) {
        return null;
    }

    const [, day, month, year, hour, minute] = match;
    const parsedDate = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute)
    );

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function keepRecentChanges(history: BranchChangeHistory): BranchChangeHistory {
    const cutoff = Date.now() - ONE_DAY_MS;

    const recentChanges = history.changes.filter((change) => {
        const changeDate = parseTimestamp(change.timestamp);
        return changeDate ? changeDate.getTime() >= cutoff : false;
    });

    return {
        ...history,
        totalChanges: recentChanges.length,
        changes: recentChanges,
    };
}

/**
 * Отправка отчёта о сборе изменений в Telegram
 */
async function sendFetchReport(
    totalBranches: number,
    totalChanges: number,
    branchesWithChanges: number,
    top5: { branchId: string; name?: string; totalChanges: number }[]
): Promise<void> {
    const lines = [
        `📊 Сбор изменений завершён`,
        ``,
        `Филиалов проверено: ${totalBranches}`,
        `Всего изменений: ${totalChanges}`,
        `Филиалов с изменениями: ${branchesWithChanges}`,
    ];

    if (top5.length > 0) {
        lines.push(``);
        lines.push(`🏆 Топ по изменениям:`);
        for (const item of top5) {
            lines.push(`• ${item.name || item.branchId}: ${item.totalChanges}`);
        }
    }

    await sendMessage(lines.join("\n"));
}

export async function fetchAllChanges(options: { telegram?: boolean } = {}) {
    const { telegram = true } = options; // по умолчанию отправляем
    try {
        const authOk = await ensureYandexAuth();
        if (!authOk) {
            throw new Error("Авторизация Яндекс не выполнена.");
        }

        console.log("\n✅ Сессия Яндекс проверена. Загружаем филиалы...");

        // Читаем список филиалов
        const branchesRaw = await fs.readFile(BRANCHES_FILE, "utf8");
        const branches: YandexBranch[] = JSON.parse(branchesRaw);

        console.log(`📦 Загружено филиалов: ${branches.length}`);

        // Фильтруем филиалы с changesUrl
        const branchesWithChanges = branches.filter(b => b.changesUrl && b.id);

        console.log(`🔗 Филиалов с changesUrl: ${branchesWithChanges.length}`);

        if (branchesWithChanges.length === 0) {
            console.log("⚠️  Нет филиалов с changesUrl. Запустите сначала npm run run:once");
            return;
        }

        // Собираем изменения для всех филиалов
        const allChanges: BranchChangeHistory[] = [];
        let processed = 0;

        console.log("\n🚀 Начинаем сбор истории изменений...\n");

        const tasks = branchesWithChanges.map((branch) =>
            limit(async () => {
                if (!branch.changesUrl || !branch.id) return null;

                const history = await fetchBranchChangeHistory(branch.changesUrl, branch.id);
                const filteredHistory = keepRecentChanges(history);
                const originalTotal = history.totalChanges;
                processed++;

                console.log(
                    `[${processed}/${branchesWithChanges.length}] ${branch.name || branch.id}: ${filteredHistory.totalChanges} изменений${originalTotal !== filteredHistory.totalChanges ? ` (из ${originalTotal})` : ""}`
                );

                return filteredHistory;
            })
        );

        const results = await Promise.all(tasks);

        // Фильтруем null и добавляем в результат
        for (const result of results) {
            if (result) {
                allChanges.push(result);
            }
        }

        // Сохраняем результаты
        await fs.mkdir("./data", { recursive: true });
        await fs.writeFile(
            CHANGES_OUTPUT_FILE,
            JSON.stringify(allChanges, null, 2),
            "utf8"
        );

        console.log(`\n✅ Собрано историй изменений: ${allChanges.length}`);
        console.log(`💾 Данные сохранены в ${CHANGES_OUTPUT_FILE}`);

        // Статистика
        const totalChanges = allChanges.reduce((sum, h) => sum + h.totalChanges, 0);
        const branchesWithChangesCount = allChanges.filter(h => h.totalChanges > 0).length;

        console.log(`\n📊 Статистика:`);
        console.log(`   Всего изменений: ${totalChanges}`);
        console.log(`   Филиалов с изменениями: ${branchesWithChangesCount}`);
        console.log(`   Филиалов без изменений: ${allChanges.length - branchesWithChangesCount}`);

        // Топ-5 филиалов по количеству изменений
        const top5 = allChanges
            .filter(h => h.totalChanges > 0)
            .sort((a, b) => b.totalChanges - a.totalChanges)
            .slice(0, 5);

        if (top5.length > 0) {
            console.log(`\n🏆 Топ-5 филиалов по количеству изменений:`);
            top5.forEach((h, idx) => {
                const branch = branches.find(b => b.id === h.branchId);
                console.log(`   ${idx + 1}. ${branch?.name || h.branchId}: ${h.totalChanges} изменений`);
            });
        }

        // Примеры изменений
        const exampleBranch = allChanges.find(h => h.changes.length > 0);
        if (exampleBranch) {
            console.log(`\n📝 Пример изменений (филиал ${exampleBranch.branchId}):`);
            exampleBranch.changes.slice(0, 3).forEach((change, idx) => {
                console.log(`\n   [${idx + 1}] ${change.title}`);
                console.log(`       Время: ${change.timestamp}`);
                if (change.author) console.log(`       Автор: ${change.author}`);
                if (change.oldValue) console.log(`       Было: ${change.oldValue.substring(0, 100)}...`);
                if (change.newValue) console.log(`       Стало: ${change.newValue.substring(0, 100)}...`);
            });
        }

        // Отправка в Telegram
        if (telegram) {
            console.log(`\n📤 Отправляем отчёт в Telegram...`);
            const top5Data = top5.map(h => {
                const branch = branches.find(b => b.id === h.branchId);
                return { branchId: h.branchId, name: branch?.name, totalChanges: h.totalChanges };
            });
            await sendFetchReport(allChanges.length, totalChanges, branchesWithChangesCount, top5Data);
            console.log(`✅ Отчёт отправлен!`);
        }

    } catch (error: any) {
        console.error(`❌ Ошибка: ${error.message}`);
        throw error;
    } finally {
        await closeBrowser();
    }
}

// Запуск если файл вызван напрямую
const isMainModule = process.argv[1] && (
    import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
);

if (isMainModule) {
    fetchAllChanges()
        .then(() => {
            console.log("\n✅ Готово!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n❌ Ошибка:", error);
            process.exit(1);
        });
}

