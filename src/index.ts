import cron from "node-cron";
import { env } from "./config.js";
import { bot } from "./telegram.js";
import { runOnce } from "./run.js";
import { reportAllOk, reportDiffs } from "./report.js";

async function doRun() {
    try {
        const { total, diffs } = await runOnce();
        if (diffs.length === 0) await reportAllOk(total);
        else await reportDiffs(diffs);
    } catch (e: any) {
        await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID!, `❗ Ошибка проверки: ${e?.message || e}`);
    }
}

// Поддержка одноразового запуска
if (process.argv.includes("--once")) {
    doRun().then(() => process.exit(0));
} else {
    // Планировщик
    cron.schedule(
        env.CRON_SCHEDULE,
        () => {
            doRun();
        },
        { timezone: env.TZ }
    );
    console.log(`Job scheduled: ${env.CRON_SCHEDULE} (${env.TZ})`);
}
