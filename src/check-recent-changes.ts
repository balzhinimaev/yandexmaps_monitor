// src/check-recent-changes.ts
// Скрипт для проверки изменений за последние 24 часа и обновления branches.json

import { promises as fs } from "fs";
import { ensureYandexAuth, closeBrowser, checkRecentChanges, type YandexBranch } from "./yandex.js";
import { sendMessage } from "./telegram.js";
import pLimit from "p-limit";
import {
    isPublished,
    compareBranchLists,
    formatChangeTime,
    createSnapshot,
    type BranchSnapshot,
} from "./branch-utils.js";

const BRANCHES_FILE = "./data/branches.json";
const BRANCHES_SNAPSHOT_FILE = "./data/branches-snapshot.json"; // для сравнения количества

// Ограничиваем количество одновременных запросов
const limit = pLimit(3);

/**
 * Загрузка предыдущего снапшота филиалов
 */
async function loadPreviousSnapshot(): Promise<BranchSnapshot[]> {
    try {
        const data = await fs.readFile(BRANCHES_SNAPSHOT_FILE, "utf8");
        return JSON.parse(data);
    } catch {
        return [];
    }
}

/**
 * Сохранение текущего снапшота филиалов
 */
async function saveSnapshot(branches: YandexBranch[]): Promise<void> {
    const snapshot = createSnapshot(branches);
    await fs.writeFile(BRANCHES_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

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
    branchesWithChanges: YandexBranch[],
    addedBranches: YandexBranch[],
    removedBranches: BranchSnapshot[],
    previousTotal: number
): Promise<void> {
    const lines: string[] = [];

    // Заголовок в зависимости от наличия изменений
    const hasAnyChanges = withChanges > 0 || addedBranches.length > 0 || removedBranches.length > 0;
    
    if (!hasAnyChanges) {
        lines.push(`✅ Проверка завершена`);
        lines.push(``);
        lines.push(`Проверено филиалов: ${total}`);
        lines.push(`За последние 24ч изменений не обнаружено.`);
    } else {
        lines.push(`⚠️ Обнаружены изменения за 24ч`);
        lines.push(``);
        lines.push(`Проверено филиалов: ${total}`);
        
        // Показываем изменение количества филиалов
        if (previousTotal > 0 && previousTotal !== total) {
            const diff = total - previousTotal;
            const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
            lines.push(`Было филиалов: ${previousTotal} → стало: ${total} (${diffStr})`);
        }
        
        if (withChanges > 0) {
            lines.push(`С изменениями: ${withChanges}`);
        }

        // Новые филиалы
        if (addedBranches.length > 0) {
            lines.push(``);
            lines.push(`🆕 Новые филиалы (${addedBranches.length}):`);
            for (const branch of addedBranches.slice(0, 10)) {
                const name = branch.name || branch.id || "?";
                const address = branch.address || "";
                lines.push(`  ➕ ${name}`);
                if (address) {
                    lines.push(`     📍 ${address}`);
                }
            }
            if (addedBranches.length > 10) {
                lines.push(`  ... и ещё ${addedBranches.length - 10}`);
            }
        }

        // Удалённые филиалы
        if (removedBranches.length > 0) {
            lines.push(``);
            lines.push(`🗑 Убыли филиалы (${removedBranches.length}):`);
            for (const branch of removedBranches.slice(0, 10)) {
                const name = branch.name || branch.id || "?";
                const address = branch.address || "";
                lines.push(`  ➖ ${name}`);
                if (address) {
                    lines.push(`     📍 ${address}`);
                }
            }
            if (removedBranches.length > 10) {
                lines.push(`  ... и ещё ${removedBranches.length - 10}`);
            }
        }

        // Филиалы с изменениями контента
        if (withChanges > 0) {
            lines.push(``);
            lines.push(`📋 Филиалы с изменениями:`);

            for (const branch of branchesWithChanges.slice(0, 15)) {
                const name = branch.name || branch.id || "?";
                const address = branch.address || "";
                const count = branch.recentChangesCount || 0;
                const time = branch.lastChangeTime ? formatChangeTime(branch.lastChangeTime) : "";
                const changeTypes = branch.recentChangeTypes || [];

                lines.push(``);
                lines.push(`• ${name}`);
                if (address) {
                    lines.push(`  📍 ${address}`);
                }
                lines.push(`  ${count} изм.${time ? ` (${time})` : ""}`);

                // Показываем типы изменений, если есть
                if (changeTypes.length > 0) {
                    // Ограничиваем до 5 типов изменений
                    const displayTypes = changeTypes.slice(0, 5);
                    for (const changeType of displayTypes) {
                        lines.push(`    ↳ ${changeType}`);
                    }
                    if (changeTypes.length > 5) {
                        lines.push(`    ↳ ... и ещё ${changeTypes.length - 5}`);
                    }
                }
            }

            if (branchesWithChanges.length > 15) {
                lines.push(``);
                lines.push(`... и ещё ${branchesWithChanges.length - 15} филиалов`);
            }
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

        // Загружаем предыдущий снапшот для сравнения
        const previousSnapshot = await loadPreviousSnapshot();
        const previousTotal = previousSnapshot.length;
        console.log(`📸 Предыдущий снапшот: ${previousTotal} филиалов`);

        // Сравниваем списки
        const { added: addedBranches, removed: removedBranches } = compareBranchLists(previousSnapshot, branches);
        
        if (addedBranches.length > 0) {
            console.log(`🆕 Новых филиалов: ${addedBranches.length}`);
            addedBranches.forEach(b => console.log(`   + ${b.name || b.id}`));
        }
        if (removedBranches.length > 0) {
            console.log(`🗑  Убыло филиалов: ${removedBranches.length}`);
            removedBranches.forEach(b => console.log(`   - ${b.name || b.id}`));
        }

        // Фильтруем только опубликованные филиалы с changesUrl
        const branchesWithChanges = branches
            .map((branch, index) => ({ branch, index }))
            .filter(({ branch }) => branch.changesUrl && branch.id && isPublished(branch));

        const skippedCount = branches.filter(b => b.id && !isPublished(b)).length;
        if (skippedCount > 0) {
            console.log(`⏭️  Пропущено закрытых/неопубликованных: ${skippedCount}`);
        }

        console.log(`🔗 Опубликованных филиалов с changesUrl: ${branchesWithChanges.length}`);

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
                        lastChangeTime: result.lastChangeTime,
                        recentChangeTypes: result.recentChangeTypes
                    });

                    if (result.hasRecentChanges) {
                        withRecentChanges++;
                        const changeTypesStr = result.recentChangeTypes?.length
                            ? ` [${result.recentChangeTypes.slice(0, 3).join(", ")}${result.recentChangeTypes.length > 3 ? "..." : ""}]`
                            : "";
                        console.log(
                            `✅ [${processed}/${branchesWithChanges.length}] ${branch.name || branch.id}: ` +
                            `${result.recentChangesCount} изменений за 24ч (последнее: ${result.lastChangeTime})${changeTypesStr}`
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
                const changeTypesStr = b.recentChangeTypes?.length
                    ? `\n      Изменения: ${b.recentChangeTypes.join(", ")}`
                    : "";
                console.log(
                    `   ${idx + 1}. ${b.name || b.id}: ${b.recentChangesCount} изменений` +
                    (b.lastChangeTime ? ` (${b.lastChangeTime})` : '') +
                    changeTypesStr
                );
            });
        } else {
            console.log(`\n✨ За последние 24 часа изменений не обнаружено`);
        }

        // Сохраняем снапшот для следующего сравнения
        await saveSnapshot(branches);
        console.log(`\n📸 Снапшот сохранён в ${BRANCHES_SNAPSHOT_FILE}`);

        // Отправка отчёта в Telegram
        if (telegram) {
            console.log(`\n📤 Отправляем отчёт в Telegram...`);
            await sendCheckReport(
                processed,
                withRecentChanges,
                changedBranches,
                addedBranches,
                removedBranches,
                previousTotal
            );
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
    // По умолчанию отправляем в TG, если не указан --no-telegram
    const useTelegram = !args.includes("--no-telegram");

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

