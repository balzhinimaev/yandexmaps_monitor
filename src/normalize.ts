export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type Interval = { from: string; to: string };
export type Schedule = {
    is24x7: boolean;
    byDay: Partial<Record<Weekday, Interval[]>>;
};

const allDays: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Нормализация «ежедневно. 09:00 - 22:00», «ежедн. 09:00-22:00», «круглосуточно»
export function normalizeXmlWorkingTime(text: string): Schedule {
    const t = (text || "").toLowerCase().replace(/\s+/g, " ").replace(/[.–—]/g, "-").trim();
    if (!t || /круглосуточно/.test(t)) return { is24x7: true, byDay: {} };
    const m = t.match(/(ежедн|ежедневно)[^.]*\.?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (m) {
        const from = pad(m[2]);
        const to = pad(m[3]);
        const byDay: Schedule["byDay"] = {};
        for (const d of allDays) byDay[d] = [{ from, to }];
        return { is24x7: false, byDay };
    }
    // Фоллбек: неизвестный формат -> пустой (считаться будет как несовпадение)
    return { is24x7: false, byDay: {} };
}

function pad(hhmm: string) {
    const [h, m] = hhmm.split(":");
    return `${h.padStart(2, "0")}:${m}`;
}
