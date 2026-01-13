import { promises as fs } from "fs";
import { ensureYandexAuth, closeBrowser, fetchBranches } from "./yandex.js";

export async function runOnce() {
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
    } finally {
        await closeBrowser();
    }
}
