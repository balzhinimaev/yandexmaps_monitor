/**
 * Утилиты для работы с филиалами
 * Чистые функции без внешних зависимостей для удобного тестирования
 */

/**
 * Тип филиала (минимальный для утилит)
 */
export type BranchLike = {
    id?: string;
    name?: string;
    address?: string;
    status?: string;
};

/**
 * Тип для снапшота филиалов
 */
export type BranchSnapshot = {
    id: string;
    name?: string;
    address?: string;
};

// Статусы, которые считаем "опубликованными"
export const PUBLISHED_STATUSES = ["Опубликовано", "published", "active"];

/**
 * Проверка, является ли филиал опубликованным
 */
export function isPublished(branch: BranchLike): boolean {
    if (!branch.status) return true; // если статус не указан, считаем опубликованным
    return PUBLISHED_STATUSES.some((s) => branch.status!.toLowerCase().includes(s.toLowerCase()));
}

/**
 * Сравнение списков филиалов
 */
export function compareBranchLists<T extends BranchLike>(
    previous: BranchSnapshot[],
    current: T[]
): { added: T[]; removed: BranchSnapshot[] } {
    const previousIds = new Set(previous.map((b) => b.id));
    const currentPublished = current.filter((b) => b.id && isPublished(b));
    const currentIds = new Set(currentPublished.map((b) => b.id));

    const added = currentPublished.filter((b) => b.id && !previousIds.has(b.id));
    const removed = previous.filter((b) => !currentIds.has(b.id));

    return { added, removed };
}

/**
 * Форматирование даты из "28-01-2026 · 17:47" в "28-01-2026 - 17:47"
 */
export function formatChangeTime(timestamp: string | undefined): string {
    if (!timestamp) return "";
    // Заменяем " · " на " - " для более компактного отображения
    return timestamp.replace(/\s*·\s*/g, " - ");
}

/**
 * Нормализация записи времени в diff (например, "8-21,55" -> "8:00–21:55")
 */
export function normalizeDiffTimeValue(value: string | undefined): string {
    if (!value) return "";

    return value.replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s*,\s*(\d{1,2}))?\b/g, (_match, startHour, endHour, endMinute) => {
        const start = `${startHour}:00`;
        const end = `${endHour}:${(endMinute ?? "00").padStart(2, "0")}`;
        return `${start}–${end}`;
    });
}

export function isWorkScheduleTitle(title: string | undefined): boolean {
    const normalizedTitle = (title || "").toLowerCase();
    return normalizedTitle.includes("график") || normalizedTitle.includes("режим работы");
}

export function formatWorkScheduleDiffLines(detail: { oldValue?: string; newValue?: string }): string[] {
    const lines: string[] = [];
    if (detail.oldValue) {
        lines.push(`Было: ${normalizeDiffTimeValue(detail.oldValue)}`);
    }
    if (detail.newValue) {
        lines.push(`Стало: ${normalizeDiffTimeValue(detail.newValue)}`);
    }
    return lines;
}

/**
 * Создание снапшота из списка филиалов
 */
export function createSnapshot<T extends BranchLike>(branches: T[]): BranchSnapshot[] {
    return branches
        .filter((b) => b.id && isPublished(b))
        .map((b) => ({
            id: b.id!,
            name: b.name,
            address: b.address,
        }));
}
