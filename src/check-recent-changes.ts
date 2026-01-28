// src/check-recent-changes.ts
// Скрипт для проверки изменений за последние 24 часа и обновления branches.json

import { promises as fs } from "fs";
import { ensureYandexAuth, closeBrowser, checkRecentChanges, type YandexBranch } from "./yandex.js";
import { sendMessage } from "./telegram.js";
import pLimit from "p-limit";

const BRANCHES_FILE = "./data/branches.json";

// Ограничиваем количество одновременных запросов
const limit = pLimit(3);

async function updateBranchInFile(branches: YandexBranch[], index: number, updates: Partial<YandexBranch>) {
    branches[index] = { ...branches[index], ...updates };
    // Сохраняем после каждого обновления
    await fs.writeFile(BRANCHES_FILE, JSON.stringify(branches, null, 2), "utf8");
}

// Флаг для отслеживания прерывания
let isShuttingDown = false;

/**
 * Отправка отчёта о проверке в Telegram
 */
async function sendCheckReport(
    total: number,
    withChanges: number,
    branchesWithChanges: YandexBranch[]
): Promise<void> {
    const lines: string[] = [];

    if (withChanges === 0) {
        lines.push(`✅ Проверка завершена`);
        lines.push(``);
        lines.push(`Проверено филиалов: ${total}`);
        lines.push(`За последние 24ч изменений не обнаружено.`);
    } else {
        lines.push(`⚠️ Обнаружены изменения за 24ч`);
        lines.push(``);
        lines.push(`Проверено филиалов: ${total}`);
        lines.push(`С изменениями: ${withChanges}`);
        lines.push(``);
        lines.push(`📋 Филиалы с изменениями:`);

        for (const branch of branchesWithChanges.slice(0, 15)) {
            const name = branch.name || branch.id || "?";
            const address = branch.address || "";
            const count = branch.recentChangesCount || 0;
            const time = branch.lastChangeTime ? ` (${branch.lastChangeTime})` : "";

            lines.push(``);
            lines.push(`• ${name}`);
            if (address) {
                lines.push(`  📍 ${address}`);
            }
            lines.push(`  ${count} изм.${time}`);
        }

        if (branchesWithChanges.length > 15) {
            lines.push(``);
            lines.push(`... и ещё ${branchesWithChanges.length - 15} филиалов`);
        }
    }

    await sendMessage(lines.join("\n"));
}

export async function checkAllRecentChanges(options: { telegram?: boolean } = {}) {
    const { telegram = true } = options; // по умолчанию отправляем в Telegram
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
        const branchesWithChanges = branches
            .map((branch, index) => ({ branch, index }))
            .filter(({ branch }) => branch.changesUrl && branch.id);

        console.log(`🔗 Филиалов с changesUrl: ${branchesWithChanges.length}`);

        if (branchesWithChanges.length === 0) {
            console.log("⚠️  Нет филиалов с changesUrl. Запустите сначала npm run run:once");
            return;
        }

        let processed = 0;
        let withRecentChanges = 0;

        console.log("\n🚀 Начинаем проверку изменений за последние 24 часа...\n");
        console.log("💾 Результаты сохраняются в branches.json после каждой проверки\n");

        const tasks = branchesWithChanges.map(({ branch, index }) =>
            limit(async () => {
                // Проверяем флаг прерывания
                if (isShuttingDown) {
                    return;
                }

                if (!branch.changesUrl || !branch.id) return;

                try {
                    const result = await checkRecentChanges(branch.changesUrl, branch.id);
                    processed++;

                    // Обновляем филиал в массиве и сохраняем файл
                    await updateBranchInFile(branches, index, {
                        hasRecentChanges: result.hasRecentChanges,
                        recentChangesCount: result.recentChangesCount,
                        lastChangeTime: result.lastChangeTime
                    });

                    if (result.hasRecentChanges) {
                        withRecentChanges++;
                        console.log(
                            `✅ [${processed}/${branchesWithChanges.length}] ${branch.name || branch.id}: ` +
                            `${result.recentChangesCount} изменений за 24ч (последнее: ${result.lastChangeTime})`
                        );
                    } else {
                        console.log(
                            `⚪ [${processed}/${branchesWithChanges.length}] ${branch.name || branch.id}: нет изменений за 24ч` +
                            (result.lastChangeTime ? ` (последнее: ${result.lastChangeTime})` : '')
                        );
                    }
                } catch (error: any) {
                    // Игнорируем ошибки при завершении работы
                    if (isShuttingDown) {
                        return;
                    }

                    console.error(`❌ [${processed}/${branchesWithChanges.length}] ${branch.name || branch.id}: ошибка - ${error.message}`);

                    // Даже при ошибке сохраняем отсутствие изменений
                    await updateBranchInFile(branches, index, {
                        hasRecentChanges: false,
                        recentChangesCount: 0
                    });
                }
            })
        );

        await Promise.all(tasks);

        console.log(`\n✅ Проверка завершена!`);
        console.log(`📊 Статистика:`);
        console.log(`   Всего проверено: ${processed}`);
        console.log(`   С изменениями за 24ч: ${withRecentChanges}`);
        console.log(`   Без изменений: ${processed - withRecentChanges}`);
        console.log(`\n💾 Все данные сохранены в ${BRANCHES_FILE}`);

        // Показываем филиалы с изменениями
        const changedBranches = branches.filter(b => b.hasRecentChanges);

        if (withRecentChanges > 0) {
            console.log(`\n🔥 Филиалы с изменениями за последние 24 часа:`);
            changedBranches.forEach((b, idx) => {
                console.log(
                    `   ${idx + 1}. ${b.name || b.id}: ${b.recentChangesCount} изменений` +
                    (b.lastChangeTime ? ` (${b.lastChangeTime})` : '')
                );
            });
        } else {
            console.log(`\n✨ За последние 24 часа изменений не обнаружено`);
        }

        // Отправка отчёта в Telegram
        if (telegram) {
            console.log(`\n📤 Отправляем отчёт в Telegram...`);
            await sendCheckReport(processed, withRecentChanges, changedBranches);
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
    // Парсинг аргументов
    const args = process.argv.slice(2);
    const useTelegram = args.includes("--telegram") || args.includes("-t");

    // Обработка сигналов завершения
    const handleShutdown = async (signal: string) => {
        if (isShuttingDown) return;

        isShuttingDown = true;
        console.log(`\n🛑 Получен сигнал завершения (${signal})...`);
        console.log("⏳ Закрываем браузер и сохраняем данные...");

        try {
            await closeBrowser();
            console.log("✅ Браузер закрыт");
        } catch (error) {
            // Игнорируем ошибки при закрытии
        }

        process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    checkAllRecentChanges({ telegram: useTelegram })
        .then(() => {
            console.log("\n✅ Готово!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n❌ Ошибка:", error);
            process.exit(1);
        });
}

