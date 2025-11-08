import "dotenv/config";
import { z } from "zod";

const Env = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(10),
    TELEGRAM_CHAT_ID: z.string(),
    YANDEX_API_KEY: z.string().min(10),
    BROWSER_HEADLESS: z.string().default("true"),
    YMAPS_LANG: z.string().default("ru_RU"),
    YMAPS_RESULTS: z.coerce.number().int().min(1).max(50).default(5),
    YMAPS_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(8),
    MAX_DISTANCE_METERS: z.coerce.number().int().min(10).max(1000).default(80),
    XML_URL: z.string().url(),
    CRON_SCHEDULE: z.string().default("0 5 * * *"),
    TZ: z.string().default("Europe/Moscow"),
    TIME_TOLERANCE_MINUTES: z.coerce.number().int().min(0).max(180).default(0),
    CACHE_JSON: z.string().default("./data/mapping.json"),
    LAST_RUN_LOG: z.string().default("./data/last_run.json"),
    HTTP_TIMEOUT_MS: z.coerce.number().int().min(2000).max(60000).default(15000),
    RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
});

export const env = Env.parse(process.env);
export const CHAT_ID = Number(env.TELEGRAM_CHAT_ID) || env.TELEGRAM_CHAT_ID; // поддержка строкового/числового
