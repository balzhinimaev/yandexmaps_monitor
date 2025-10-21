import { Telegraf } from "telegraf";
import { env, CHAT_ID } from "./config.js";

export const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

export async function sendMessage(text: string) {
    return bot.telegram.sendMessage(CHAT_ID as any, text, {
        link_preview_options: { is_disabled: true },
    });
}

// Утилита: разбиение длинных сообщений по лимиту 4096
export async function sendChunks(prefix: string, body: string) {
    const TELEGRAM_LIMIT = 4096;
    const chunks: string[] = [];
    let rest = body;

    // Учитываем длину заголовка при разбиении
    const headerLength = prefix.length + 50; // +50 для "(продолжение N/M)\n"
    const effectiveLimit = TELEGRAM_LIMIT - headerLength;

    while (rest.length > effectiveLimit) {
        // Ищем последний перенос строки перед лимитом
        const idx = rest.lastIndexOf("\n", effectiveLimit);
        const cut = idx > 0 ? idx : effectiveLimit;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
    }

    if (rest.length > 0) {
        chunks.push(rest);
    }

    for (let i = 0; i < chunks.length; i++) {
        const head = i === 0 ? prefix : `${prefix} (часть ${i + 1}/${chunks.length})`;
        const message = `${head}\n${chunks[i]}`;

        // Дополнительная проверка на случай очень длинного префикса
        if (message.length > TELEGRAM_LIMIT) {
            console.warn(`Message still too long (${message.length} chars), truncating...`);
            await sendMessage(message.slice(0, TELEGRAM_LIMIT - 20) + "\n...(обрезано)");
        } else {
            await sendMessage(message);
        }
    }
}
