import "dotenv/config";
import { z } from "zod";

const Env = z.object({
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().optional(),
    BROWSER_HEADLESS: z.string().default("true"),
    AUTH_CHECK_URL: z.string().url().optional(),
    CHAIN_BRANCHES_URL: z.string().url().default("https://yandex.ru/sprav/chain/7877265/branches"),
    XML_URL: z.string().url().optional(),
    HTTP_TIMEOUT_MS: z.coerce.number().default(30000),
});

export const env = Env.parse(process.env);
export const CHAT_ID =
    env.TELEGRAM_CHAT_ID && !Number.isNaN(Number(env.TELEGRAM_CHAT_ID))
        ? Number(env.TELEGRAM_CHAT_ID)
        : env.TELEGRAM_CHAT_ID;
export const AUTH_CHECK_URL = env.AUTH_CHECK_URL ?? env.CHAIN_BRANCHES_URL;
