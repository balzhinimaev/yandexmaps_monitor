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
