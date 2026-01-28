import { chromium, Browser, BrowserContext, Page } from "playwright";
import { promises as fs } from "fs";
import { env, AUTH_CHECK_URL } from "./config.js";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let authValidated = false;
let authEnsuringPromise: Promise<boolean> | null = null;

const AUTH_STATE_PATH = "./data/auth-state.json";
const AUTH_LOGIN_URL = "https://passport.yandex.ru/auth";
const BRANCHES_URL = env.CHAIN_BRANCHES_URL;

/**
 * Упрощённая запись об изменении: название типа + дата
 */
export type SimpleChange = {
    title: string; // например "Изменение координат", "Удаление вида деятельности"
    date: string; // например "11-11-2025 · 07:52"
};

export type YandexBranch = {
    id?: string;
    name?: string;
    address?: string;
    status?: string;
    hours?: string; // режим работы (текст)
    url?: string;
    changesUrl?: string;
    hasRecentChanges?: boolean; // есть ли изменения за последние 24 часа
    recentChangesCount?: number; // количество изменений за последние 24 часа
    lastChangeTime?: string; // время последнего изменения
    changesHistory?: SimpleChange[]; // история изменений (название + дата)
    raw?: Record<string, unknown>;
};

export type BranchChange = {
    title: string; // название изменения, например "Изменение адреса"
    oldValue?: string; // старое значение (если есть)
    newValue?: string; // новое значение (если есть)
    timestamp: string; // время изменения, например "27-10-2025 · 02:29"
    author?: string; // кто внёс изменение, например "ya.robot"
};

export type BranchChangeHistory = {
    branchId: string;
    changesUrl: string;
    totalChanges: number; // общее количество изменений
    changes: BranchChange[]; // список изменений
};

type ExtractionStatus = {
    branches: YandexBranch[];
    captcha: boolean;
    needsLogin: boolean;
};

/**
 * Инициализация браузера с сохранённым профилем
 */
export async function initBrowser() {
    if (browser) return browser;

    console.log("🌐 Запуск браузера...");

    browser = await chromium.launch({
        headless: env.BROWSER_HEADLESS !== "false",
        channel: "chrome",
    });

    const hasAuth = await fs
        .access(AUTH_STATE_PATH)
        .then(() => true)
        .catch(() => false);

    const baseContext = {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 },
        locale: "ru-RU",
        timezoneId: "Europe/Moscow",
    } as const;

    if (hasAuth) {
        console.log("✅ Загружаем сохранённую сессию");
        const authState = JSON.parse(await fs.readFile(AUTH_STATE_PATH, "utf8"));
        context = await browser.newContext({
            ...baseContext,
            storageState: authState,
        });
    } else {
        console.log("⚠️  Сохранённой сессии нет, требуется авторизация");
        context = await browser.newContext(baseContext);
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
        await page.goto(AUTH_LOGIN_URL, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        console.log("\n" + "=".repeat(80));
        console.log("⚠️  ТРЕБУЕТСЯ РУЧНАЯ АВТОРИЗАЦИЯ");
        console.log("=".repeat(80));
        console.log("\n1. Откройте браузер, который только что открылся");
        console.log("2. Введите логин и пароль от Яндекса");
        console.log("3. Пройдите 2FA если требуется");
        console.log("4. После входа НЕ ЗАКРЫВАЙТЕ браузер!");
        console.log("5. Подождите ~10 секунд - скрипт автоматически продолжит работу\n");
        console.log("💡 Признак успешного входа: вы увидите главную страницу Яндекса или");
        console.log("   страницу, где отображается ваш профиль/аватар\n");

        // Ждём URL изменится (уйдём со страницы авторизации)
        console.log("⏳ Ожидаем завершения авторизации...");

        let authCompleted = false;
        const startTime = Date.now();
        const timeoutMs = 300000; // 5 минут

        while (!authCompleted && Date.now() - startTime < timeoutMs) {
            await page.waitForTimeout(2000);

            const currentUrl = page.url();

            // Проверяем наличие сессионных cookies
            const cookies = await page.context().cookies();
            const sessionCookies = cookies.filter((c) => c.name === "Session_id" || c.name === "sessguard" || c.name === "yandex_login");
            const hasSessionCookies = sessionCookies.length > 0;

            // Логируем текущее состояние для отладки
            const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            if (elapsedSec % 10 === 0 && elapsedSec > 0) {
                console.log(`   ⏳ Ожидание: ${elapsedSec}с, URL: ${currentUrl.substring(0, 60)}...`);
            }

            // Успешная авторизация определяется по:
            // 1. Наличие сессионных cookies (главный критерий)
            // 2. И уход с домена passport.yandex.ru (пользователь залогинился и был редиректнут)
            if (hasSessionCookies) {
                console.log(`✓ Обнаружены сессионные cookies: ${sessionCookies.map((c) => c.name).join(", ")}`);

                // Если есть cookies, но мы ещё на passport - ждём редиректа
                if (currentUrl.includes("passport.yandex.ru")) {
                    console.log("   ⏳ Ожидаем редирект с passport.yandex.ru...");
                    await page.waitForTimeout(3000);
                    const newUrl = page.url();
                    if (!newUrl.includes("passport.yandex.ru")) {
                        console.log("✓ Редирект завершён");
                    }
                }
                authCompleted = true;
                break;
            }

            // Если ушли с passport.yandex.ru без cookies - возможно, авторизация отменена
            if (!currentUrl.includes("passport.yandex.ru")) {
                // Даём время на установку cookies после редиректа
                await page.waitForTimeout(3000);
                const cookiesAfterRedirect = await page.context().cookies();
                const sessionAfterRedirect = cookiesAfterRedirect.filter((c) => c.name === "Session_id" || c.name === "sessguard" || c.name === "yandex_login");

                if (sessionAfterRedirect.length > 0) {
                    console.log(`✓ Обнаружены сессионные cookies после редиректа: ${sessionAfterRedirect.map((c) => c.name).join(", ")}`);
                    authCompleted = true;
                    break;
                } else {
                    console.log("⚠️  Произошёл редирект с passport.yandex.ru, но сессионные cookies не найдены");
                    console.log("   Текущий URL:", currentUrl);
                    console.log("   Возможно, авторизация была отменена или произошла ошибка");
                    // Продолжаем ожидание - возможно, пользователь вернётся на страницу авторизации
                }
            }
        }

        if (!authCompleted) {
            throw new Error("Превышено время ожидания авторизации (5 минут). Убедитесь, что вы успешно вошли в аккаунт Яндекс.");
        }

        // Даём время на полную загрузку и установку всех cookies
        console.log("⏳ Ожидаем полной установки сессии (8 секунд)...");
        await page.waitForTimeout(8000);

        // Дополнительная проверка cookies
        const finalCookies = await page.context().cookies();
        const sessionCookiesCheck = finalCookies.filter((c: any) => c.name === "Session_id" || c.name === "sessguard" || c.name === "yandex_login");

        if (sessionCookiesCheck.length === 0) {
            console.warn("⚠️  Предупреждение: не найдены ожидаемые сессионные cookies");
            console.log("   Попытаемся сохранить сессию в любом случае...");
        }

        console.log("\n✅ Авторизация успешна!");

        // Сохраняем состояние авторизации
        await fs.mkdir("./data", { recursive: true });
        const authState = await context!.storageState();

        // Проверяем, что есть важные cookies
        const cookies = authState.cookies;
        const sessionCookies = cookies.filter((c: any) => c.name === "Session_id" || c.name === "sessguard" || c.name === "yandex_login");

        console.log(`🍪 Сохранено ${cookies.length} cookies, из них ${sessionCookies.length} сессионных`);

        await fs.writeFile(AUTH_STATE_PATH, JSON.stringify(authState, null, 2));

        console.log("💾 Сессия сохранена в", AUTH_STATE_PATH);
        console.log("\n✅ Можете продолжать работу!\n");

        await page.close();
        return true;
    } catch (error: any) {
        console.error("❌ Ошибка авторизации:", error.message);
        await page.close();
        return false;
    }
}

type EnsureAuthOptions = {
    forceRecheck?: boolean;
};

export async function ensureYandexAuth(options: EnsureAuthOptions = {}): Promise<boolean> {
    const { forceRecheck = false } = options;

    // Для отладки можно принудительно сбросить валидацию через переменную окружения
    if (process.env.FORCE_REAUTH === "true") {
        authValidated = false;
    }

    if (authValidated && !forceRecheck) {
        return true;
    }

    if (authEnsuringPromise) {
        return authEnsuringPromise;
    }

    authEnsuringPromise = (async () => {
        await initBrowser();

        if (!forceRecheck) {
            const valid = await checkSession();
            if (valid) {
                console.log("✅ Сессия Яндекс актуальна, повторная авторизация не требуется");
                authValidated = true;
                return true;
            }
        } else {
            console.log("🔄 Принудительная проверка сессии Яндекс");
        }

        console.log("⚠️  Требуется авторизация Яндекс. Убедитесь, что `BROWSER_HEADLESS=false` и выполните вход вручную.");
        const loggedIn = await loginToYandex();
        authValidated = loggedIn;
        return loggedIn;
    })();

    try {
        return await authEnsuringPromise;
    } finally {
        authEnsuringPromise = null;
    }
}

/**
 * Проверка валидности сохранённой сессии
 */
export async function checkSession(): Promise<boolean> {
    try {
        const page = await newPage();

        try {
            console.log("🔍 Проверяем сессию Яндекс...");

            await page.goto(AUTH_CHECK_URL, {
                waitUntil: "domcontentloaded",
                timeout: 15000,
            });

            // Даем время на загрузку и применение cookies
            await page.waitForTimeout(2000);

            // Собираем cookies текущего контекста (httpOnly тоже)
            const cookies = await page.context().cookies();
            const cookieNames = new Set(cookies.map((cookie) => cookie.name));

            const sessionCookieNames = ["Session_id", "sessguard", "yandex_login", "sprav_session"];

            const foundSessionCookies = sessionCookieNames.filter((name) => cookieNames.has(name));
            const hasSessionCookie = foundSessionCookies.length > 0;

            console.log(`🍪 Найдено cookies сессии: ${foundSessionCookies.length > 0 ? foundSessionCookies.join(", ") : "нет"}`);

            // Проверяем, авторизованы ли мы
            const status = await page.evaluate(() => {
                const doc = document;
                const bodyText = doc.body?.innerText ?? "";
                const hasCaptcha = !!doc.querySelector("smart-captcha") || bodyText.includes("SmartCaptcha") || bodyText.includes("Я не робот");
                const loginLinks = Array.from(doc.querySelectorAll('a[href*="passport.yandex.ru"]'));
                const needsLogin = loginLinks.some((el) => /войти|логин/i.test(el.textContent || ""));
                const hasUserMenu = !!doc.querySelector('[data-tid*="user"], [data-testid*="user"], [class*="User"], [class*="user"]');

                return {
                    hasCaptcha,
                    needsLogin,
                    hasUserMenu,
                };
            });

            console.log(`📊 Проверка: captcha=${status.hasCaptcha}, needsLogin=${status.needsLogin}, hasUserMenu=${status.hasUserMenu}`);

            if (status.hasCaptcha) {
                console.log("⚠️  Обнаружена SmartCaptcha на проверочном URL. Требуется пройти проверку вручную.");
                return false;
            }

            // Считаем авторизацию валидной если есть сессионные cookies И отсутствуют ссылки на вход
            const loggedIn = hasSessionCookie && !status.needsLogin;

            if (!loggedIn && status.needsLogin) {
                console.log("⚠️  Сессия Яндекс неактивна, требуется авторизация");
            }

            if (loggedIn && status.needsLogin) {
                console.log("ℹ️  Найдены элементы входа, однако cookies сессии присутствуют. Считаем авторизацию валидной.");
            }

            if (loggedIn) {
                console.log("✅ Сессия Яндекс активна");
            }

            return loggedIn;
        } finally {
            await page.close();
        }
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

/**
 * Проверить есть ли изменения за последние 24 часа
 */
export async function checkRecentChanges(
    changesUrl: string,
    branchId: string
): Promise<{
    hasRecentChanges: boolean;
    recentChangesCount: number;
    lastChangeTime?: string;
}> {
    const page = await newPage();

    try {
        await page.goto(changesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const result = await page.evaluate(() => {
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            // Парсинг времени в формате "17-09-2025 · 02:05"
            // @ts-ignore
            const parseTimestamp = (timeStr) => {
                if (!timeStr) return null;
                const match = timeStr.match(/(\d{2})-(\d{2})-(\d{4})\s*·\s*(\d{2}):(\d{2})/);
                if (!match) return null;

                const [, day, month, year, hour, minute] = match;
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
            };

            const requestBlocks = Array.from(document.querySelectorAll(".RequestChanges.CompanyChangesPage-Request"));

            let recentCount = 0;
            let lastChangeTime;

            for (const requestBlock of requestBlocks) {
                const timeEl = requestBlock.querySelector(".RequestChanges-RequestTime");
                const timestamp = timeEl?.textContent?.trim() || "";

                const changeDate = parseTimestamp(timestamp);
                if (!changeDate) continue;

                if (!lastChangeTime) {
                    lastChangeTime = timestamp;
                }

                if (changeDate >= oneDayAgo) {
                    recentCount++;
                }
            }

            return {
                hasRecentChanges: recentCount > 0,
                recentChangesCount: recentCount,
                lastChangeTime,
            };
        });

        return result;
    } catch (error: any) {
        console.error(`❌ Ошибка при проверке изменений: ${error.message}`);
        return {
            hasRecentChanges: false,
            recentChangesCount: 0,
        };
    } finally {
        await page.close();
    }
}

/**
 * Получить упрощённую историю изменений (только название + дата)
 */
export async function fetchSimpleBranchChanges(changesUrl: string): Promise<SimpleChange[]> {
    const page = await newPage();

    try {
        console.log(`🔍 Загружаем историю изменений: ${changesUrl}`);
        await page.goto(changesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const extraction = await page.evaluate(() => {
            const result: {
                changes: Array<{ title: string; date: string }>;
                captcha: boolean;
                needsLogin: boolean;
            } = {
                changes: [],
                captcha: false,
                needsLogin: false,
            };

            const doc = document;
            const bodyText = doc.body?.innerText ?? "";

            // Проверяем капчу и авторизацию
            result.captcha = !!doc.querySelector("smart-captcha") || bodyText.includes("SmartCaptcha") || bodyText.includes("Я не робот");

            const loginLinks = Array.from(doc.querySelectorAll('a[href*="passport.yandex.ru"]'));
            result.needsLogin = loginLinks.some((el) => /войти|логин/i.test(el.textContent || ""));

            if (result.captcha || result.needsLogin) {
                return result;
            }

            // Находим все блоки изменений (RequestChanges)
            const requestBlocks = Array.from(doc.querySelectorAll(".RequestChanges.CompanyChangesPage-Request"));

            for (const requestBlock of requestBlocks) {
                // Время изменения
                const timeEl = requestBlock.querySelector(".RequestChanges-RequestTime");
                const date = timeEl?.textContent?.trim() || "";

                // Все изменения внутри этого блока
                const changeElements = Array.from(requestBlock.querySelectorAll(".CompanyChanges-Change"));

                for (const changeEl of changeElements) {
                    const titleEl = changeEl.querySelector(".CompanyChanges-ChangeTitle");
                    const title = titleEl?.textContent?.trim() || "";

                    if (title && date) {
                        result.changes.push({ title, date });
                    }
                }
            }

            return result;
        });

        if (extraction.captcha) {
            throw new Error(`SmartCaptcha на странице изменений: ${changesUrl}`);
        }

        if (extraction.needsLogin) {
            throw new Error(`Требуется авторизация для просмотра изменений: ${changesUrl}`);
        }

        console.log(`   ✓ Найдено изменений: ${extraction.changes.length}`);
        return extraction.changes;
    } catch (error: any) {
        console.error(`❌ Ошибка при загрузке истории изменений: ${error.message}`);
        return [];
    } finally {
        await page.close();
    }
}

/**
 * Получить историю изменений для конкретного филиала
 */
export async function fetchBranchChangeHistory(changesUrl: string, branchId: string): Promise<BranchChangeHistory> {
    const page = await newPage();

    try {
        console.log(`🔍 Загружаем историю изменений: ${changesUrl}`);
        await page.goto(changesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

        // Даём время на загрузку контента
        await page.waitForTimeout(2000);

        // Парсим изменения
        const extraction = await page.evaluate(() => {
            const result: {
                changes: Array<{
                    title: string;
                    oldValue?: string;
                    newValue?: string;
                    timestamp: string;
                    author?: string;
                }>;
                captcha: boolean;
                needsLogin: boolean;
            } = {
                changes: [],
                captcha: false,
                needsLogin: false,
            };

            const doc = document;
            const bodyText = doc.body?.innerText ?? "";

            // Проверяем капчу и авторизацию
            result.captcha = !!doc.querySelector("smart-captcha") || bodyText.includes("SmartCaptcha") || bodyText.includes("Я не робот");

            const loginLinks = Array.from(doc.querySelectorAll('a[href*="passport.yandex.ru"]'));
            result.needsLogin = loginLinks.some((el) => /войти|логин/i.test(el.textContent || ""));

            if (result.captcha || result.needsLogin) {
                return result;
            }

            // Находим все блоки изменений
            const requestBlocks = Array.from(doc.querySelectorAll(".RequestChanges.CompanyChangesPage-Request"));

            for (const requestBlock of requestBlocks) {
                // Время и автор
                const timeEl = requestBlock.querySelector(".RequestChanges-RequestTime");
                const authorEl = requestBlock.querySelector(".RequestChanges-RequestLogin");
                const timestamp = timeEl?.textContent?.trim() || "";
                const author = authorEl?.textContent?.trim();

                // Все изменения внутри этого блока
                const changeElements = Array.from(requestBlock.querySelectorAll(".CompanyChanges-Change"));

                for (const changeEl of changeElements) {
                    const titleEl = changeEl.querySelector(".CompanyChanges-ChangeTitle");
                    const title = titleEl?.textContent?.trim() || "";

                    // Ищем diff элементы (старое/новое значение)
                    const diffContainer = changeEl.querySelector(".CompanyChanges-ChangeDiff");

                    let oldValue: string | undefined;
                    let newValue: string | undefined;

                    if (diffContainer) {
                        // Ищем элементы с действиями add/remove
                        const addEl = diffContainer.querySelector(".CompanyChanges-ChangeDiffItem_action_add");
                        const removeEl = diffContainer.querySelector(".CompanyChanges-ChangeDiffItem_action_remove");

                        if (addEl) {
                            newValue = addEl.textContent?.trim();
                        }
                        if (removeEl) {
                            oldValue = removeEl.textContent?.trim();
                        }

                        // Если это карта (например, изменение координат)
                        const mapDiffs = diffContainer.querySelector(".CompanyChanges-MapsDiffs");
                        if (mapDiffs && !newValue && !oldValue) {
                            const addBadge = mapDiffs.querySelector(".CompanyChanges-MapImageBadge_action_add");
                            const removeBadge = mapDiffs.querySelector(".CompanyChanges-MapImageBadge_action_remove");

                            if (addBadge) {
                                newValue = "[Изменение на карте]";
                            }
                            if (removeBadge) {
                                oldValue = "[Прежнее положение на карте]";
                            }
                        }
                    }

                    result.changes.push({
                        title,
                        oldValue,
                        newValue,
                        timestamp,
                        author,
                    });
                }
            }

            return result;
        });

        if (extraction.captcha) {
            throw new Error(`SmartCaptcha на странице изменений: ${changesUrl}`);
        }

        if (extraction.needsLogin) {
            throw new Error(`Требуется авторизация для просмотра изменений: ${changesUrl}`);
        }

        console.log(`   ✓ Найдено изменений: ${extraction.changes.length}`);

        return {
            branchId,
            changesUrl,
            totalChanges: extraction.changes.length,
            changes: extraction.changes,
        };
    } catch (error: any) {
        console.error(`❌ Ошибка при загрузке истории изменений: ${error.message}`);
        return {
            branchId,
            changesUrl,
            totalChanges: 0,
            changes: [],
        };
    } finally {
        await page.close();
    }
}

type FetchBranchesOptions = {
    url?: string;
    withChanges?: boolean; // если true, то для каждого филиала загрузим историю изменений
};

export async function fetchBranches(options: FetchBranchesOptions | string = {}): Promise<YandexBranch[]> {
    // Поддержка старого API (только URL)
    const opts: FetchBranchesOptions = typeof options === "string" ? { url: options } : options;
    const url = opts.url || BRANCHES_URL;
    const withChanges = opts.withChanges || false;
    const page = await newPage();

    // Добавляем полифилл для __name ДО загрузки страницы
    await page.addInitScript(() => {
        (window as any).__name = function (fn: any, name: string) {
            return fn;
        };
    });

    const allBranches: YandexBranch[] = [];
    let currentPage = 1;
    let hasMorePages = true;
    const defaultOrigin = "https://yandex.ru";
    let pageOrigin = defaultOrigin;
    let pageClosed = false;

    try {
        console.log(`🌐 Загружаем страницу филиалов: ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        try {
            pageOrigin = new URL(page.url()).origin;
        } catch {
            try {
                pageOrigin = new URL(url).origin;
            } catch {
                pageOrigin = defaultOrigin;
            }
        }

        while (hasMorePages) {
            // Ждем появления данных
            console.log(`📄 Загружаем страницу ${currentPage}...`);
            await page
                .waitForFunction(
                    function () {
                        return !!(
                            (window as any).__PRELOAD_DATA ||
                            (window as any).__INITIAL_DATA ||
                            (window as any).__DATA ||
                            (window as any).__SERP_TASK_STATE ||
                            document.querySelector(".BranchesList-CompanyRow")
                        );
                    },
                    { timeout: 15000 }
                )
                .catch((err) => {
                    console.log("⚠️  Данные не появились за 15 секунд:", err.message);
                });

            // Извлекаем филиалы с текущей страницы
            const extraction = await page.evaluate(function () {
                const result: {
                    branches: any[];
                    captcha: boolean;
                    needsLogin: boolean;
                } = {
                    branches: [],
                    captcha: false,
                    needsLogin: false,
                };

                const doc = document;
                const bodyText = doc.body && doc.body.innerText ? doc.body.innerText : "";
                result.captcha = !!doc.querySelector("smart-captcha") || bodyText.includes("SmartCaptcha") || bodyText.includes("Я не робот");

                const loginLinks = Array.from(doc.querySelectorAll('a[href*="passport.yandex.ru"]'));
                result.needsLogin = loginLinks.some(function (el) {
                    return /войти|логин/i.test(el.textContent || "");
                });

                if (result.captcha || result.needsLogin) {
                    return result;
                }

                const globalData =
                    (window as any).__PRELOAD_DATA || (window as any).__INITIAL_DATA || (window as any).__DATA || (window as any).__SERP_TASK_STATE;

                function extractFromData() {
                    const items =
                        (globalData && globalData.chainBranches && globalData.chainBranches.items) ||
                        (globalData &&
                            globalData.state &&
                            globalData.state.page &&
                            globalData.state.page.data &&
                            globalData.state.page.data.chainBranches &&
                            globalData.state.page.data.chainBranches.items) ||
                        (globalData &&
                            globalData.state &&
                            globalData.state.pageData &&
                            globalData.state.pageData.chainBranches &&
                            globalData.state.pageData.chainBranches.items) ||
                        (globalData && globalData.data && globalData.data.chainBranches && globalData.data.chainBranches.items);

                    if (Array.isArray(items)) {
                        result.branches = items.map(function (item) {
                            // Извлечение часов работы из разных возможных полей
                            let hours = undefined;
                            if (item && item.workingTime) {
                                hours = typeof item.workingTime === "string" ? item.workingTime : item.workingTime.text;
                            } else if (item && item.hours) {
                                hours = typeof item.hours === "string" ? item.hours : item.hours.text;
                            } else if (item && item.workingHours) {
                                hours = typeof item.workingHours === "string" ? item.workingHours : item.workingHours.text;
                            }

                            return {
                                id: (item && item.id) || (item && item.branchId) || (item && item.businessId) || undefined,
                                name: (item && item.name) || (item && item.title) || undefined,
                                address: (item && item.address && item.address.text) || (item && item.address) || undefined,
                                status: (item && item.status) || (item && item.workingStatus) || undefined,
                                hours: hours,
                                url: (item && item.link) || (item && item.url) || undefined,
                                raw: item || undefined,
                            };
                        });
                    }
                }

                extractFromData();

                if (result.branches.length === 0) {
                    const selectorCandidates = [
                        ".BranchesList-CompanyRow",
                        '[data-testid="branch-card"]',
                        '[data-tid="branch-card"]',
                        '[data-tid="branch"]',
                        ".chain-branches__card",
                        ".ListItemView-ListItem",
                    ];

                    let elements: Element[] = [];
                    for (let i = 0; i < selectorCandidates.length; i++) {
                        const selector = selectorCandidates[i];
                        elements = Array.from(doc.querySelectorAll(selector));
                        if (elements.length) break;
                    }

                    if (elements.length) {
                        result.branches = elements.map(function (el) {
                            const nameEl =
                                el.querySelector(".CompanyInfoCard-CompanyName") ||
                                el.querySelector('[data-tid="branch-name"]') ||
                                el.querySelector('[data-testid="branch-name"]') ||
                                el.querySelector("h3, h2");
                            const addressEl =
                                el.querySelector(".CompanyInfoCard-CompanyAddress") ||
                                el.querySelector('[data-tid="branch-address"]') ||
                                el.querySelector('[data-testid="branch-address"]') ||
                                el.querySelector('[class*="Address"]') ||
                                el.querySelector("address");
                            const statusEl =
                                el.querySelector(".StatusLabel") ||
                                el.querySelector('[data-tid="branch-status"]') ||
                                el.querySelector('[data-testid="branch-status"]') ||
                                el.querySelector('[class*="Status"]');
                            const hoursEl =
                                el.querySelector(".CompanyInfoCard-WorkingTime") ||
                                el.querySelector('[data-tid="branch-hours"]') ||
                                el.querySelector('[data-testid="branch-hours"]') ||
                                el.querySelector('[class*="WorkingTime"]') ||
                                el.querySelector('[class*="Hours"]');
                            const linkEl = el.querySelector("a[href]");

                            let id = undefined;
                            if (linkEl) {
                                const href = linkEl.getAttribute("href");
                                if (href) {
                                    const match = href.match(/\/sprav\/(\d+)/);
                                    if (match) {
                                        id = match[1];
                                    }
                                }
                            }

                            return {
                                id: id || el.getAttribute("data-id") || undefined,
                                name: (nameEl && nameEl.textContent && nameEl.textContent.trim()) || undefined,
                                address: (addressEl && addressEl.textContent && addressEl.textContent.trim()) || undefined,
                                status: (statusEl && statusEl.textContent && statusEl.textContent.trim()) || undefined,
                                hours: (hoursEl && hoursEl.textContent && hoursEl.textContent.trim()) || undefined,
                                url: (linkEl && linkEl.getAttribute("href")) || undefined,
                                raw: undefined,
                            };
                        });
                    }
                }

                return result;
            });

            if (extraction.captcha) {
                throw new Error("На странице появилась SmartCaptcha. Пройдите проверку вручную в открытом окне браузера.");
            }

            if (extraction.needsLogin) {
                throw new Error("Требуется повторная авторизация в Яндекс для просмотра списка филиалов.");
            }

            if (extraction.branches.length === 0) {
                console.warn("⚠️  Не удалось распарсить филиалы на странице", currentPage);
                break;
            }

            const enhancedBranches = extraction.branches.map((branch) => {
                const result: YandexBranch = { ...branch };
                if (branch.url) {
                    try {
                        const absolute = new URL(branch.url, pageOrigin).href;
                        const changesHref = absolute.replace(/\/p\/edit\/[^/]*\/?$/, "/p/edit/changes/");
                        result.changesUrl = changesHref;
                    } catch {
                        // noop
                    }
                }
                return result;
            });

            allBranches.push(...enhancedBranches);
            console.log(`   ✓ Получено ${extraction.branches.length} филиалов (всего: ${allBranches.length})`);

            // Проверяем наличие кнопки "Вперед" и кликаем по ней
            const paginationInfo = await page.evaluate(function () {
                const allPaginationLinks = Array.from(document.querySelectorAll(".Pagination-Link"));
                const paginationTotals = document.querySelector(".Pagination-Totals");
                const selectedPage = document.querySelector(".Pagination-Link_selected");

                const linksInfo = allPaginationLinks.map(function (link) {
                    return {
                        text: link.textContent ? link.textContent.trim() : "",
                        classes: link.className,
                        isTypeText: link.classList.contains("Pagination-Link_type_text"),
                    };
                });

                // Парсим totalsText, удаляя лишние пробелы между цифрами
                let totalsText = null;
                if (paginationTotals && paginationTotals.textContent) {
                    totalsText = paginationTotals.textContent.replace(/\s+/g, " ").trim();
                }

                return {
                    allLinks: linksInfo,
                    totalsText: totalsText,
                    selectedPageText: selectedPage && selectedPage.textContent ? selectedPage.textContent.trim() : null,
                };
            });

            console.log(`   🔍 Пагинация: страница ${paginationInfo.selectedPageText}, всего: ${paginationInfo.totalsText}`);

            // Ищем кнопку "Вперед"
            const hasNextButton = paginationInfo.allLinks.some(
                (link) => link.text && (link.text.includes("Вперед") || link.text.includes("далее") || link.text.includes("→"))
            );

            if (!hasNextButton) {
                console.log("✅ Все страницы загружены (кнопка 'Вперед' не найдена)");
                hasMorePages = false;
                break;
            }

            // Запоминаем текущий номер страницы перед кликом
            const currentPageNumber = paginationInfo.selectedPageText;
            console.log(`   ⏳ Переход со страницы ${currentPageNumber} на следующую...`);

            // Кликаем по кнопке "Вперед"
            const clicked = await page.evaluate(function () {
                const links = Array.from(document.querySelectorAll(".Pagination-Link"));
                const nextLink = links.find(function (link) {
                    const text = link.textContent ? link.textContent.trim() : "";
                    return text.includes("Вперед") || text.includes("далее") || text === "→";
                });
                if (nextLink && !nextLink.classList.contains("ya-business-link_disabled")) {
                    (nextLink as HTMLElement).click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                console.log("⚠️  Не удалось кликнуть по кнопке 'Вперед', завершаем пагинацию");
                hasMorePages = false;
                break;
            }

            currentPage++;

            // Ждем изменения номера выбранной страницы
            const pageChanged = await page
                .waitForFunction(
                    function (prevPageNumber) {
                        const selectedPage = document.querySelector(".Pagination-Link_selected");
                        if (!selectedPage || !selectedPage.textContent) return false;
                        const currentPageText = selectedPage.textContent.trim();
                        return currentPageText !== prevPageNumber && currentPageText !== "";
                    },
                    currentPageNumber,
                    { timeout: 10000 }
                )
                .catch(() => {
                    console.log("   ⚠️  Timeout при ожидании изменения номера страницы");
                    return null;
                });

            if (!pageChanged) {
                console.log("⚠️  Страница не обновилась после клика, завершаем пагинацию");
                hasMorePages = false;
                break;
            }

            // Дополнительная задержка для загрузки данных
            await page.waitForTimeout(1000);
            await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        }

        if (allBranches.length === 0) {
            console.warn("⚠️  Не удалось распарсить список филиалов. Сохраняем HTML для отладки.");
            await fs.mkdir("./data", { recursive: true });
            const html = await page.content();
            await fs.writeFile("./data/branches-last.html", html);
        }

        // Закрываем страницу списка до загрузки истории изменений
        await page.close();
        pageClosed = true;

        // Если нужно загрузить историю изменений для каждого филиала
        if (withChanges && allBranches.length > 0) {
            console.log(`\n📜 Загружаем историю изменений для ${allBranches.length} филиалов...`);

            for (let i = 0; i < allBranches.length; i++) {
                // for (let i = 5; i !== 0; i-=5) {
                const branch = allBranches[i];
                if (branch.changesUrl) {
                    console.log(`   [${i + 1}/${allBranches.length}] ${branch.name || branch.id}`);
                    try {
                        const changes = await fetchSimpleBranchChanges(branch.changesUrl);
                        branch.changesHistory = changes;
                    } catch (error) {
                        const errMsg = error instanceof Error ? error.message : String(error);
                        console.error(`   ❌ Ошибка: ${errMsg}`);
                        branch.changesHistory = [];
                    }
                    // Небольшая задержка между запросами
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
            }

            console.log(`✅ История изменений загружена для всех филиалов`);
        }

        return allBranches;
    } catch (error) {
        if (!pageClosed) {
            await page.close();
        }
        throw error;
    }
}
