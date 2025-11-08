import axios from "axios";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { promises as fs } from "fs";
import { getDistance } from "geolib";
import { env } from "./config.js";

let browser: Browser | null = null;
let context: BrowserContext | null = null;

const AUTH_STATE_PATH = "./data/auth-state.json";

const YMAPS_SEARCH_URL = "https://search-maps.yandex.ru/v1/";

export type CandidateHoursInterval = {
    from: string;
    to: string;
    days?: string[];
    everyday?: boolean;
};

export type SearchCandidate = {
    id?: string;
    name: string;
    address?: string;
    lat: number;
    lon: number;
    distance: number;
    url?: string;
    hoursText?: string;
    hoursAvail?: CandidateHoursInterval[];
    raw?: unknown;
};

export type SearchParams = {
    lat: number;
    lon: number;
    address?: string;
    queryName: string;
};

export async function searchCandidates(params: SearchParams): Promise<SearchCandidate[]> {
    try {
        const response = await axios.get(YMAPS_SEARCH_URL, {
            params: {
                apikey: env.YANDEX_API_KEY,
                lang: env.YMAPS_LANG,
                results: env.YMAPS_RESULTS,
                rspn: 1,
                ll: `${params.lon},${params.lat}`,
                type: "biz",
                text: `${params.queryName} ${params.address ?? ""}`.trim(),
                spn: "0.02,0.02",
            },
            timeout: env.HTTP_TIMEOUT_MS,
        });

        const features: any[] = response.data?.features ?? [];

        const candidates: SearchCandidate[] = features
            .map((feature) => toCandidate(feature, params))
            .filter((c): c is SearchCandidate => Boolean(c))
            .sort((a, b) => a.distance - b.distance);

        console.log(`🔍 Найдено кандидатов: ${candidates.length}`);
        candidates.slice(0, 3).forEach((cand, idx) => {
            console.log(
                `   [${idx + 1}] ${cand.name} — ${cand.address || "(адрес не указан)"} (${Math.round(cand.distance)} м)`
            );
        });

        return candidates;
    } catch (error: any) {
        console.error("❌ Ошибка поиска в Яндекс.Картах:", error?.message || error);
        return [];
    }
}

export function pickBest(candidates: SearchCandidate[], lat: number, lon: number): SearchCandidate | undefined {
    if (!candidates.length) return undefined;
    const sorted = [...candidates].sort((a, b) => a.distance - b.distance);
    const within = sorted.find((c) => c.distance <= env.MAX_DISTANCE_METERS);
    if (within) return within;
    // пересчитаем расстояние относительно переданных координат, если вдруг кандидаты были получены без дистанции
    sorted.forEach((cand) => {
        cand.distance = getDistance(
            { latitude: lat, longitude: lon },
            { latitude: cand.lat, longitude: cand.lon }
        );
    });
    return sorted.sort((a, b) => a.distance - b.distance)[0];
}

function toCandidate(feature: any, original: SearchParams): SearchCandidate | undefined {
    const coords: [number, number] | undefined = feature?.geometry?.coordinates;
    if (!coords || coords.length !== 2) return undefined;
    const [lon, lat] = coords;

    if (typeof lat !== "number" || typeof lon !== "number") return undefined;

    const properties = feature?.properties ?? {};
    const company = properties.CompanyMetaData ?? {};
    const hours = normalizeHours(company.Hours);

    const distance = getDistance(
        { latitude: original.lat, longitude: original.lon },
        { latitude: lat, longitude: lon }
    );

    return {
        id: company.id || feature.id,
        name: company.name || properties.name || original.queryName,
        address: company.address || properties.description || original.address,
        lat,
        lon,
        distance,
        url: company.url,
        hoursText: hours.text,
        hoursAvail: hours.availabilities,
        raw: feature,
    };
}

function normalizeHours(hours: any): { text?: string; availabilities?: CandidateHoursInterval[] } {
    if (!hours) return {};

    const availabilities: CandidateHoursInterval[] = [];

    for (const availability of hours.Availabilities ?? []) {
        const intervals = availability?.Intervals ?? [];
        for (const interval of intervals) {
            if (!interval?.from || !interval?.to) continue;
            availabilities.push({
                from: interval.from,
                to: interval.to,
                days: availability?.Days,
                everyday: Boolean(availability?.Everyday),
            });
        }
    }

    const text: string | undefined =
        hours.text ||
        (hours.isTwentyFourHours || hours.IsTwentyFourHours ? "круглосуточно" : undefined) ||
        (availabilities.some((a) => a.everyday && a.from === "00:00" && a.to === "24:00") ? "круглосуточно" : undefined);

    return { text, availabilities: availabilities.length ? availabilities : undefined };
}

/**
 * Инициализация браузера с сохранённым профилем
 */
export async function initBrowser() {
    if (browser) return browser;

    console.log("🌐 Запуск браузера...");

    browser = await chromium.launch({
        headless: env.BROWSER_HEADLESS !== "false",
        channel: "chrome", // использовать установленный Chrome
    });

    // Проверяем, есть ли сохранённая сессия
    const hasAuth = await fs.access(AUTH_STATE_PATH).then(() => true).catch(() => false);

    if (hasAuth) {
        console.log("✅ Загружаем сохранённую сессию");
        const authState = JSON.parse(await fs.readFile(AUTH_STATE_PATH, "utf8"));
        context = await browser.newContext({
            storageState: authState,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport: { width: 1920, height: 1080 },
            locale: "ru-RU",
            timezoneId: "Europe/Moscow",
        });
    } else {
        console.log("⚠️  Сохранённой сессии нет, требуется авторизация");
        context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport: { width: 1920, height: 1080 },
            locale: "ru-RU",
            timezoneId: "Europe/Moscow",
        });
    }

    return browser;
}

/**
 * Получить контекст браузера (с сохранённой сессией)
 */
export async function getContext(): Promise<BrowserContext> {
    if (!context) {
        await initBrowser();
    }
    return context!;
}

/**
 * Создать новую страницу
 */
export async function newPage(): Promise<Page> {
    const ctx = await getContext();
    return ctx.newPage();
}

/**
 * Авторизация в Яндексе (интерактивная)
 */
export async function loginToYandex() {
    console.log("🔑 Начинаем авторизацию в Яндексе...");

    const page = await newPage();

    try {
        // Переходим на страницу авторизации
        await page.goto("https://passport.yandex.ru/auth", {
            waitUntil: "networkidle",
            timeout: 30000
        });

        console.log("\n" + "=".repeat(80));
        console.log("⚠️  ТРЕБУЕТСЯ РУЧНАЯ АВТОРИЗАЦИЯ");
        console.log("=".repeat(80));
        console.log("\n1. Откройте браузер, который только что открылся");
        console.log("2. Введите логин и пароль от Яндекса");
        console.log("3. Пройдите 2FA если требуется");
        console.log("4. Дождитесь полной загрузки главной страницы Яндекса");
        console.log("5. Скрипт автоматически продолжит работу\n");

        // Ждём, пока пользователь авторизуется
        // Признак успешной авторизации - появление элемента профиля
        await page.waitForSelector('[class*="User"], .PSHeader-User, .desk-notif-card__login-button', {
            timeout: 300000 // 5 минут на авторизацию
        });

        // Даём время на полную загрузку
        await page.waitForTimeout(3000);

        console.log("\n✅ Авторизация успешна!");

        // Сохраняем состояние авторизации
        await fs.mkdir("./data", { recursive: true });
        const authState = await context!.storageState();
        await fs.writeFile(AUTH_STATE_PATH, JSON.stringify(authState, null, 2));

        console.log("💾 Сессия сохранена в", AUTH_STATE_PATH);

        await page.close();
        return true;

    } catch (error: any) {
        console.error("❌ Ошибка авторизации:", error.message);
        await page.close();
        return false;
    }
}

/**
 * Проверка валидности сохранённой сессии
 */
export async function checkSession(): Promise<boolean> {
    try {
        const page = await newPage();

        await page.goto("https://yandex.ru/maps", {
            waitUntil: "networkidle",
            timeout: 15000
        });

        // Проверяем, авторизованы ли мы
        const isLoggedIn = await page.evaluate(() => {
            return !!(
                document.querySelector('[class*="User"]') ||
                document.querySelector('.PSHeader-User') ||
                document.querySelector('[data-bem*="user"]')
            );
        });

        await page.close();

        if (!isLoggedIn) {
            console.log("⚠️  Сессия истекла, требуется повторная авторизация");
        }

        return isLoggedIn;

    } catch (error) {
        console.log("⚠️  Не удалось проверить сессию:", error);
        return false;
    }
}

/**
 * Закрыть браузер
 */
export async function closeBrowser() {
    if (context) {
        await context.close();
        context = null;
    }
    if (browser) {
        await browser.close();
        browser = null;
    }
}

// Graceful shutdown
process.on("SIGINT", async () => {
    console.log("\n🛑 Получен сигнал завершения...");
    await closeBrowser();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("\n🛑 Получен сигнал завершения...");
    await closeBrowser();
    process.exit(0);
});
