import { Schedule } from "./normalize.js";

export type CompareResult = {
    ok: boolean;
    reasons: string[];
    targetText?: string; // из XML
    actualText?: string; // из Яндекс
};

export function compareSchedules(xml: Schedule, yHours: { text?: string; avail?: any }, _toleranceMin: number): CompareResult {
    // Простая стратегия: если XML — 24/7, а у Яндекс не 24/7 → нарушение
    // Если XML — диапазон одинаковый ежедневно, сравниваем с текстом Яндекс (нормализуя пробелы и тире)
    const reasons: string[] = [];

    const norm = (s: string | undefined) => (s || "").toLowerCase().replace(/\s+/g, " ").replace(/[.–—]/g, "-").trim();

    if (xml.is24x7) {
        const t = norm(yHours.text);
        if (!/24\s*\/\s*7|круглосуточно/.test(t)) reasons.push("Ожидалось: круглосуточно");
    } else {
        // XML: ежедневный интервал
        const days = Object.values(xml.byDay).filter(Boolean);
        if (!days.length) reasons.push("Не распознан формат часов в XML");
        else {
            const [sample] = days[0]!; // берём первый интервал
            const t = norm(yHours.text);
            // жёсткая проверка по тексту (учитывая толеранс = 0 по ТЗ)
            const expect = `${sample.from}-${sample.to}`;
            if (!t.includes(expect)) reasons.push(`Ожидалось: ${expect} ежедневно`);
        }
    }

    return {
        ok: reasons.length === 0,
        reasons,
        targetText: summarizeXml(xml),
        actualText: yHours.text,
    };
}

function summarizeXml(xml: Schedule) {
    if (xml.is24x7) return "круглосуточно";
    const days = Object.values(xml.byDay).filter(Boolean);
    if (!days.length) return "(не распознано)";
    const [sample] = days[0]!;
    return `ежедневно ${sample.from}-${sample.to}`;
}
