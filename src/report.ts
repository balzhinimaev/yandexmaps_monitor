import { sendMessage, sendChunks } from "./telegram.js";

type ItemDiff = {
    companyId: string;
    name: string;
    address: string;
    expected: string;
    actual?: string;
    url?: string;
};

export async function reportAllOk(count: number) {
    const msg = `✅ Проверка завершена\nВсе ${count} точек в порядке. Данные на Яндекс.Картах соответствуют XML.`;
    await sendMessage(msg);
}

export async function reportDiffs(diffs: ItemDiff[]) {
    const head = `⚠️ Обнаружено расхождений: ${diffs.length}`;
    const lines = diffs.map(
        (d) =>
            `\n❌ ID: ${d.companyId}\n` +
            ` Название: ${d.name}\n` +
            ` Адрес: ${d.address}\n` +
            ` Ожидалось: ${d.expected}\n` +
            ` На картах: ${d.actual || "—"}${d.url ? `\n Карточка: ${d.url}` : ""}`
    );
    await sendChunks(head, lines.join("\n"));
}
