import { runOnce } from "./run.js";

// Экспорты для использования в других модулях
export { runOnce } from "./run.js";
export { fetchAllChanges } from "./fetch-changes.js";
export { checkAllRecentChanges } from "./check-recent-changes.js";
export {
    fetchBranches,
    fetchBranchChangeHistory,
    checkRecentChanges,
    ensureYandexAuth,
    closeBrowser,
    type YandexBranch,
    type BranchChange,
    type BranchChangeHistory
} from "./yandex.js";

async function doRun() {
    try {
        await runOnce();
    } catch (e: any) {
        console.error(`❗ Ошибка: ${e?.message || e}`);
        process.exitCode = 1;
    }
}

// Запуск только если файл вызван напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
    doRun()
        .then(() => {
            if (process.argv.includes("--once")) {
                process.exit();
            }
        })
        .catch(() => {
            if (process.argv.includes("--once")) {
                process.exit(1);
            }
        });
}


