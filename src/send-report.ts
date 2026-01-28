/**
 * Принудительная отправка отчёта в Telegram
 *
 * Использование:
 *   npm run report:ok              - отправить "всё в порядке"
 *   npm run report:ok -- 50        - отправить количество точек
 *   npm run report:diff            - тестовое расхождение
 *   npm run report:pdf             - отправить PDF файл
 *   npm run report:pdf -- путь.pdf - отправить указанный PDF
 *   npm run report -- "Текст"      - произвольное сообщение
 */

import { sendMessage, sendDocument } from "./telegram.js";
import { reportAllOk, reportDiffs } from "./report.js";
import { existsSync } from "fs";

const DEFAULT_PDF = "./analysis-report.pdf";

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
        console.log("Использование:");
        console.log("  npm run report:ok              - отчёт 'всё в порядке'");
        console.log("  npm run report:ok -- 50        - с количеством точек");
        console.log("  npm run report:diff            - тестовое расхождение");
        console.log("  npm run report:pdf             - отправить PDF");
        console.log("  npm run report:pdf -- путь.pdf - указать путь к PDF");
        console.log('  npm run report -- "Текст"      - произвольное сообщение');
        process.exit(0);
    }

    try {
        if (command === "ok") {
            const count = parseInt(args[1]) || 0;
            console.log(`📤 Отправка отчёта: всё в порядке (${count} точек)...`);
            await reportAllOk(count);
            console.log("✅ Отчёт отправлен!");
        } else if (command === "diff") {
            console.log("📤 Отправка тестового отчёта о расхождениях...");
            await reportDiffs([
                {
                    companyId: "MANUAL-001",
                    name: "Тестовая точка",
                    address: "г. Москва, ул. Тестовая, д. 1",
                    expected: "круглосуточно",
                    actual: "09:00-21:00",
                    url: "https://yandex.ru/maps",
                },
            ]);
            console.log("✅ Отчёт о расхождениях отправлен!");
        } else if (command === "pdf") {
            const pdfPath = args[1] || DEFAULT_PDF;

            if (!existsSync(pdfPath)) {
                console.error(`❌ Файл не найден: ${pdfPath}`);
                console.log("   Сначала сгенерируйте PDF: npm run analyze:pdf");
                process.exitCode = 1;
                return;
            }

            console.log(`📤 Отправка PDF: ${pdfPath}...`);
            await sendDocument(pdfPath, `📊 Отчёт по изменениям филиалов\n${new Date().toLocaleDateString("ru-RU")}`);
            console.log("✅ PDF отправлен!");
        } else {
            // Произвольное сообщение
            const message = args.join(" ");
            console.log(`📤 Отправка сообщения: "${message}"...`);
            await sendMessage(message);
            console.log("✅ Сообщение отправлено!");
        }
    } catch (e: any) {
        console.error(`❌ Ошибка: ${e?.message || e}`);
        process.exitCode = 1;
    }
}

main();
