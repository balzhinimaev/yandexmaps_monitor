import { promises as fs } from "fs";
import { ensureYandexAuth, closeBrowser, fetchBranches, type YandexBranch } from "./yandex.js";
import { sendMessage } from "./telegram.js";

/**
 * Отправка отчёта о сборе филиалов в Telegram
 */
async function sendRunReport(branches: YandexBranch[]): Promise<void> {
    const withChanges = branches.filter(b => b.changesHistory && b.changesHistory.length > 0);
    const totalChanges = withChanges.reduce((sum, b) => sum + (b.changesHistory?.length || 0), 0);

    const lines = [
        `📦 Сбор филиалов завершён`,
        ``,
        `Всего филиалов: ${branches.length}`,
        `С историей изменений: ${withChanges.length}`,
        `Всего изменений: ${totalChanges}`,
        ``,
        `💾 Данные сохранены в branches.json`,
    ];

    await sendMessage(lines.join("\n"));
}

export async function runOnce(options: { telegram?: boolean } = {}) {
    const { telegram = true } = options; // по умолчанию отправляем

    try {
        const authOk = await ensureYandexAuth();
        if (!authOk) {
            throw new Error("Авторизация Яндекс не выполнена.");
        }

        console.log("\n✅ Сессия Яндекс проверена. Загружаем филиалы...");

        const branches = await fetchBranches({ withChanges: true });
        console.log(`📦 Получено филиалов: ${branches.length}`);

        branches.slice(0, 5).forEach((branch, idx) => {
            console.log(`\n[${idx + 1}] ${branch.name || "(без названия)"}`);
            if (branch.address) console.log(`   Адрес: ${branch.address}`);
            if (branch.status) console.log(`   Статус: ${branch.status}`);
            if (branch.url) console.log(`   URL: ${branch.url}`);
        });

        await fs.mkdir("./data", { recursive: true });
        await fs.writeFile("./data/branches.json", JSON.stringify(branches, null, 2), "utf8");
        console.log(`\n💾 Данные филиалов сохранены в ./data/branches.json`);

        // Отправка в Telegram
        if (telegram) {
            console.log(`\n📤 Отправляем отчёт в Telegram...`);
            await sendRunReport(branches);
            console.log(`✅ Отчёт отправлен!`);
        }
    } finally {
        await closeBrowser();
    }
}
