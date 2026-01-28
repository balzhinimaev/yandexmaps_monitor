/**
 * Основной скрипт мониторинга с отправкой отчётов в Telegram
 *
 * Запуск: npm run monitor
 *
 * Выполняет:
 * 1. Загрузку данных из XML
 * 2. Получение данных филиалов с Яндекс.Карт
 * 3. Сравнение данных
 * 4. Отправку отчёта в Telegram
 */

import { promises as fs } from "fs";
import { loadCompanies, type Company } from "./xml.js";
import { ensureYandexAuth, closeBrowser, fetchBranches, type YandexBranch } from "./yandex.js";
import { reportAllOk, reportDiffs } from "./report.js";
import { env } from "./config.js";

type Diff = {
    companyId: string;
    name: string;
    address: string;
    expected: string;
    actual?: string;
    url?: string;
};

/**
 * Нормализация строки для сравнения
 */
function normalize(s: string | undefined): string {
    return (s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[.–—]/g, "-")
        .trim();
}

/**
 * Сравнение режима работы из XML с данными Яндекс.Карт
 */
function compareWorkingTime(xmlTime: string, yandexHours: string | undefined): { match: boolean; reason?: string } {
    const xmlNorm = normalize(xmlTime);
    const yandexNorm = normalize(yandexHours);

    // Проверка на круглосуточно
    const is24x7Xml = /круглосуточно|24\s*\/?\s*7|24\s*часа/.test(xmlNorm);
    const is24x7Yandex = /круглосуточно|24\s*\/?\s*7|24\s*часа/.test(yandexNorm);

    if (is24x7Xml && !is24x7Yandex) {
        return { match: false, reason: "Ожидалось: круглосуточно" };
    }

    if (is24x7Xml && is24x7Yandex) {
        return { match: true };
    }

    // Извлечение временных интервалов (формат HH:MM-HH:MM)
    const timePattern = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g;
    const xmlIntervals = [...xmlNorm.matchAll(timePattern)].map((m) => `${m[1]}-${m[2]}`);
    const yandexIntervals = [...yandexNorm.matchAll(timePattern)].map((m) => `${m[1]}-${m[2]}`);

    if (xmlIntervals.length > 0) {
        const xmlInterval = xmlIntervals[0];
        const hasMatch = yandexIntervals.some((yi) => yi === xmlInterval);

        if (!hasMatch) {
            return { match: false, reason: `Ожидалось: ${xmlInterval}` };
        }
    }

    return { match: true };
}

/**
 * Поиск соответствующего филиала на Яндекс.Картах по названию или адресу
 */
function findMatchingBranch(company: Company, branches: YandexBranch[]): YandexBranch | undefined {
    const companyName = normalize(company.name);
    const companyAddress = normalize(company.address);

    return branches.find((branch) => {
        const branchName = normalize(branch.name);
        const branchAddress = normalize(branch.address);

        // Совпадение по адресу (основной критерий)
        if (companyAddress && branchAddress && branchAddress.includes(companyAddress.slice(0, 20))) {
            return true;
        }

        // Совпадение по названию
        if (companyName && branchName && branchName.includes(companyName)) {
            return true;
        }

        return false;
    });
}

/**
 * Основная функция мониторинга
 */
export async function runMonitor(options: { dryRun?: boolean; verbose?: boolean } = {}) {
    const { dryRun = false, verbose = false } = options;

    console.log("🚀 Запуск мониторинга Яндекс.Карт\n");

    const diffs: Diff[] = [];
    let xmlCompanies: Company[] = [];
    let yandexBranches: YandexBranch[] = [];

    try {
        // 1. Загрузка данных из XML
        console.log("📄 Загрузка данных из XML...");
        if (!env.XML_URL) {
            console.warn("⚠️  XML_URL не задан, пропускаем загрузку XML");
        } else {
            xmlCompanies = await loadCompanies();
            console.log(`   Загружено компаний: ${xmlCompanies.length}`);
        }

        // 2. Авторизация и загрузка филиалов с Яндекс.Карт
        console.log("\n🔐 Авторизация в Яндекс...");
        const authOk = await ensureYandexAuth();
        if (!authOk) {
            throw new Error("Авторизация Яндекс не выполнена");
        }
        console.log("   ✅ Авторизация успешна");

        console.log("\n📍 Загрузка филиалов с Яндекс.Карт...");
        yandexBranches = await fetchBranches({ withChanges: false });
        console.log(`   Загружено филиалов: ${yandexBranches.length}`);

        // Сохранение данных для отладки
        await fs.mkdir("./data", { recursive: true });
        await fs.writeFile("./data/monitor-branches.json", JSON.stringify(yandexBranches, null, 2), "utf8");
        if (xmlCompanies.length > 0) {
            await fs.writeFile("./data/monitor-xml.json", JSON.stringify(xmlCompanies, null, 2), "utf8");
        }

        // 3. Сравнение данных
        console.log("\n🔍 Сравнение данных...");

        if (xmlCompanies.length === 0) {
            // Если XML не задан, проверяем только наличие филиалов
            console.log("   XML не загружен, проверяем только статус филиалов");

            for (const branch of yandexBranches) {
                if (branch.status && branch.status !== "Опубликовано" && branch.status !== "published") {
                    diffs.push({
                        companyId: branch.id || "unknown",
                        name: branch.name || "(без названия)",
                        address: branch.address || "(без адреса)",
                        expected: "Опубликовано",
                        actual: branch.status,
                        url: branch.url,
                    });
                }
            }
        } else {
            // Полное сравнение XML с Яндекс.Картами
            for (const company of xmlCompanies) {
                const branch = findMatchingBranch(company, yandexBranches);

                if (!branch) {
                    diffs.push({
                        companyId: company.companyId,
                        name: company.name,
                        address: company.address,
                        expected: "Найден на Яндекс.Картах",
                        actual: "Не найден",
                    });
                    continue;
                }

                // Сравнение режима работы
                if (company.workingTime && company.workingTime !== "—") {
                    const result = compareWorkingTime(company.workingTime, branch.hours);

                    if (!result.match) {
                        diffs.push({
                            companyId: company.companyId,
                            name: company.name,
                            address: company.address,
                            expected: company.workingTime,
                            actual: branch.hours || "(не указано)",
                            url: branch.url,
                        });
                    }
                }

                if (verbose) {
                    console.log(`   ✓ ${company.name}`);
                }
            }
        }

        // 4. Отправка отчёта
        console.log("\n📤 Отправка отчёта в Telegram...");

        const totalChecked = xmlCompanies.length > 0 ? xmlCompanies.length : yandexBranches.length;

        if (diffs.length === 0) {
            console.log(`   ✅ Все ${totalChecked} точек в порядке`);
            if (!dryRun) {
                await reportAllOk(totalChecked);
                console.log("   📨 Отчёт отправлен");
            } else {
                console.log("   🔄 Dry-run: отправка пропущена");
            }
        } else {
            console.log(`   ⚠️  Найдено расхождений: ${diffs.length}`);
            if (verbose) {
                diffs.forEach((d) => {
                    console.log(`      - ${d.name}: ${d.expected} → ${d.actual}`);
                });
            }
            if (!dryRun) {
                await reportDiffs(diffs);
                console.log("   📨 Отчёт о расхождениях отправлен");
            } else {
                console.log("   🔄 Dry-run: отправка пропущена");
            }
        }

        // Сохранение результатов
        await fs.writeFile(
            "./data/monitor-result.json",
            JSON.stringify(
                {
                    timestamp: new Date().toISOString(),
                    totalChecked,
                    diffsCount: diffs.length,
                    diffs,
                },
                null,
                2
            ),
            "utf8"
        );
        console.log("\n💾 Результаты сохранены в ./data/monitor-result.json");

        return { success: true, totalChecked, diffs };
    } finally {
        await closeBrowser();
    }
}

// Запуск если вызван напрямую
const isDirectRun = (() => {
    const argvPath = process.argv[1];
    if (!argvPath) return false;
    const normalizedArgvPath = argvPath.replace(/\\/g, "/");
    return import.meta.url === `file:///${normalizedArgvPath}` || import.meta.url.endsWith(normalizedArgvPath);
})();

if (isDirectRun) {
    const dryRun = process.argv.includes("--dry-run");
    const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

    runMonitor({ dryRun, verbose })
        .then((result) => {
            console.log("\n✅ Мониторинг завершён");
            if (result.diffs.length > 0) {
                process.exitCode = 1; // Есть расхождения
            }
        })
        .catch((e) => {
            console.error(`\n❗ Ошибка: ${e?.message || e}`);
            process.exitCode = 1;
        });
}
