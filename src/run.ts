import pLimit from "p-limit";
import { env } from "./config.js";
import { loadCompanies } from "./xml.js";
import { normalizeXmlWorkingTime } from "./normalize.js";
import { compareSchedules } from "./compare.js";
import { searchCandidates, pickBest } from "./yandex.js";
import { loadMapping, saveMapping, saveLastRun } from "./cache.js";

export async function runOnce() {
    const companies = await loadCompanies();
    console.log(`\n📋 Загружено компаний из XML: ${companies.length}`);

    const map = await loadMapping(env.CACHE_JSON);
    console.log(`📦 Загружено сопоставлений из кеша: ${Object.keys(map).length}`);

    const diffs: any[] = [];
    const limit = pLimit(env.YMAPS_CONCURRENCY);

    let processed = 0;
    const tasks = companies.map((c) =>
        limit(async () => {
            processed++;
            console.log(`\n${"=".repeat(80)}`);
            console.log(`[${processed}/${companies.length}] Проверка компании ID: ${c.companyId}`);
            console.log(`Название: ${c.name}`);
            console.log(`Адрес: ${c.address}`);
            console.log(`Координаты: ${c.lat}, ${c.lon}`);
            console.log(`Рабочее время: ${c.workingTime}`);

            const xmlSched = normalizeXmlWorkingTime(c.workingTime);

            // Если есть закреплённый ID — в реальном API можно добирать им точку. Здесь используем его для фильтрации кандидатов
            const cands = await searchCandidates({
                lat: c.lat,
                lon: c.lon,
                address: c.address,
                queryName: c.name,
            });
            const best = pickBest(cands, c.lat, c.lon);
            if (!best) {
                console.log(`\n❌ Результат: НЕ НАЙДЕНА на картах`);
                diffs.push({
                    companyId: c.companyId,
                    name: c.name,
                    address: c.address,
                    expected: summarizeXml(xmlSched),
                    actual: "не найдена на картах",
                });
                return;
            }

            console.log(`\n✅ Найдена на картах: "${best.name}"`);
            console.log(`   Адрес на картах: ${best.address}`);
            console.log(`   Часы работы: ${best.hoursText || "(не указаны)"}`);
            console.log(`   URL: ${best.url || "(нет)"}`);

            // Сохраняем сопоставление
            if (!map[c.companyId] && best.id) map[c.companyId] = String(best.id);

            const res = compareSchedules(xmlSched, { text: best.hoursText, avail: best.hoursAvail }, env.TIME_TOLERANCE_MINUTES);
            if (!res.ok) {
                console.log(`\n⚠️  Расхождение в часах работы!`);
                console.log(`   Ожидалось: ${res.targetText}`);
                console.log(`   На картах: ${res.actualText || "(не указано)"}`);
                diffs.push({
                    companyId: c.companyId,
                    name: c.name,
                    address: c.address,
                    expected: res.targetText!,
                    actual: res.actualText,
                    url: best.url,
                });
            } else {
                console.log(`\n✅ Часы работы совпадают`);
            }
        })
    );

    await Promise.all(tasks);

    console.log(`\n${"=".repeat(80)}`);
    console.log(`\n📊 ИТОГОВАЯ СТАТИСТИКА:`);
    console.log(`   Всего проверено: ${companies.length}`);
    console.log(`   Найдено на картах: ${companies.length - diffs.filter((d) => d.actual === "не найдена на картах").length}`);
    console.log(`   Не найдено на картах: ${diffs.filter((d) => d.actual === "не найдена на картах").length}`);
    console.log(`   Расхождений в часах: ${diffs.filter((d) => d.actual !== "не найдена на картах").length}`);
    console.log(`   Всего расхождений: ${diffs.length}`);

    await saveMapping(env.CACHE_JSON, map);
    await saveLastRun(env.LAST_RUN_LOG, {
        ts: Date.now(),
        total: companies.length,
        diffs: diffs.length,
    });

    return { total: companies.length, diffs };
}

function summarizeXml(xml: ReturnType<typeof normalizeXmlWorkingTime>) {
    if (xml.is24x7) return "круглосуточно";
    const days = Object.values(xml.byDay).filter(Boolean);
    if (!days.length) return "(не распознано)";
    const [sample] = days[0]!;
    return `ежедневно ${sample.from}-${sample.to}`;
}
