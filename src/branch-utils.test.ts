import {
    isPublished,
    compareBranchLists,
    formatChangeTime,
    normalizeDiffTimeValue,
    isWorkScheduleTitle,
    formatWorkScheduleDiffLines,
    createSnapshot,
    PUBLISHED_STATUSES,
    type BranchSnapshot,
    type BranchLike,
} from "./branch-utils.js";

describe("isPublished", () => {
    it("should return true for published status", () => {
        expect(isPublished({ status: "Опубликовано" })).toBe(true);
        expect(isPublished({ status: "published" })).toBe(true);
        expect(isPublished({ status: "active" })).toBe(true);
    });

    it("should return true for status containing published keyword (case insensitive)", () => {
        expect(isPublished({ status: "ОПУБЛИКОВАНО" })).toBe(true);
        expect(isPublished({ status: "Published" })).toBe(true);
        expect(isPublished({ status: "Active branch" })).toBe(true);
    });

    it("should return true when status is undefined", () => {
        expect(isPublished({})).toBe(true);
        expect(isPublished({ name: "Test" })).toBe(true);
    });

    it("should return false for non-published statuses", () => {
        expect(isPublished({ status: "Закрыт" })).toBe(false);
        expect(isPublished({ status: "closed" })).toBe(false);
        expect(isPublished({ status: "На модерации" })).toBe(false);
        expect(isPublished({ status: "draft" })).toBe(false);
        expect(isPublished({ status: "Удалён" })).toBe(false);
    });
});

describe("formatChangeTime", () => {
    it("should replace · with -", () => {
        expect(formatChangeTime("28-01-2026 · 17:47")).toBe("28-01-2026 - 17:47");
        expect(formatChangeTime("01-12-2025 · 09:00")).toBe("01-12-2025 - 09:00");
    });

    it("should handle multiple · in string", () => {
        expect(formatChangeTime("test · value · end")).toBe("test - value - end");
    });

    it("should handle extra spaces around ·", () => {
        expect(formatChangeTime("28-01-2026  ·  17:47")).toBe("28-01-2026 - 17:47");
        expect(formatChangeTime("28-01-2026·17:47")).toBe("28-01-2026 - 17:47");
    });

    it("should return empty string for undefined", () => {
        expect(formatChangeTime(undefined)).toBe("");
    });

    it("should return string as-is if no · present", () => {
        expect(formatChangeTime("28-01-2026 - 17:47")).toBe("28-01-2026 - 17:47");
        expect(formatChangeTime("test")).toBe("test");
    });
});

describe("normalizeDiffTimeValue", () => {
    it("should normalize non-standard time range", () => {
        expect(normalizeDiffTimeValue("8-21,55")).toBe("8:00–21:55");
    });

    it("should keep unrelated text and normalize embedded range", () => {
        expect(normalizeDiffTimeValue("пн-вс 8-21,55 без выходных")).toBe("пн-вс 8:00–21:55 без выходных");
    });
});

describe("work schedule diff helpers", () => {
    it("detects work schedule titles", () => {
        expect(isWorkScheduleTitle("Изменение графика работы")).toBe(true);
        expect(isWorkScheduleTitle("Режим работы филиала")).toBe(true);
        expect(isWorkScheduleTitle("Изменение телефона")).toBe(false);
    });

    it("formats Было/Стало lines and normalizes time", () => {
        expect(
            formatWorkScheduleDiffLines({
                oldValue: "Пн-Вс 8-20",
                newValue: "Пн-Вс 8-21,55",
            })
        ).toEqual(["Было: Пн-Вс 8:00–20:00", "Стало: Пн-Вс 8:00–21:55"]);
    });

    it("degrades gracefully when one value is missing", () => {
        expect(formatWorkScheduleDiffLines({ newValue: "8-21,55" })).toEqual(["Стало: 8:00–21:55"]);
        expect(formatWorkScheduleDiffLines({ oldValue: "8-20" })).toEqual(["Было: 8:00–20:00"]);
    });
});

describe("compareBranchLists", () => {
    const createBranch = (id: string, name?: string, status?: string): BranchLike => ({
        id,
        name: name || `Branch ${id}`,
        address: `Address ${id}`,
        status: status || "Опубликовано",
    });

    const createSnapshotItem = (id: string, name?: string): BranchSnapshot => ({
        id,
        name: name || `Branch ${id}`,
        address: `Address ${id}`,
    });

    it("should detect added branches", () => {
        const previous: BranchSnapshot[] = [createSnapshotItem("1"), createSnapshotItem("2")];
        const current: BranchLike[] = [createBranch("1"), createBranch("2"), createBranch("3", "New Branch")];

        const result = compareBranchLists(previous, current);

        expect(result.added).toHaveLength(1);
        expect(result.added[0].id).toBe("3");
        expect(result.added[0].name).toBe("New Branch");
        expect(result.removed).toHaveLength(0);
    });

    it("should detect removed branches", () => {
        const previous: BranchSnapshot[] = [
            createSnapshotItem("1"),
            createSnapshotItem("2"),
            createSnapshotItem("3", "Removed Branch"),
        ];
        const current: BranchLike[] = [createBranch("1"), createBranch("2")];

        const result = compareBranchLists(previous, current);

        expect(result.added).toHaveLength(0);
        expect(result.removed).toHaveLength(1);
        expect(result.removed[0].id).toBe("3");
        expect(result.removed[0].name).toBe("Removed Branch");
    });

    it("should detect both added and removed branches", () => {
        const previous: BranchSnapshot[] = [createSnapshotItem("1"), createSnapshotItem("2")];
        const current: BranchLike[] = [createBranch("1"), createBranch("3", "New Branch")];

        const result = compareBranchLists(previous, current);

        expect(result.added).toHaveLength(1);
        expect(result.added[0].id).toBe("3");
        expect(result.removed).toHaveLength(1);
        expect(result.removed[0].id).toBe("2");
    });

    it("should return empty arrays when lists are identical", () => {
        const previous: BranchSnapshot[] = [createSnapshotItem("1"), createSnapshotItem("2")];
        const current: BranchLike[] = [createBranch("1"), createBranch("2")];

        const result = compareBranchLists(previous, current);

        expect(result.added).toHaveLength(0);
        expect(result.removed).toHaveLength(0);
    });

    it("should handle empty previous list (first run)", () => {
        const previous: BranchSnapshot[] = [];
        const current: BranchLike[] = [createBranch("1"), createBranch("2")];

        const result = compareBranchLists(previous, current);

        expect(result.added).toHaveLength(2);
        expect(result.removed).toHaveLength(0);
    });

    it("should handle empty current list", () => {
        const previous: BranchSnapshot[] = [createSnapshotItem("1"), createSnapshotItem("2")];
        const current: BranchLike[] = [];

        const result = compareBranchLists(previous, current);

        expect(result.added).toHaveLength(0);
        expect(result.removed).toHaveLength(2);
    });

    it("should ignore non-published branches in current list", () => {
        const previous: BranchSnapshot[] = [createSnapshotItem("1")];
        const current: BranchLike[] = [
            createBranch("1"),
            createBranch("2", "Closed Branch", "Закрыт"),
            createBranch("3", "Draft Branch", "На модерации"),
        ];

        const result = compareBranchLists(previous, current);

        expect(result.added).toHaveLength(0);
        expect(result.removed).toHaveLength(0);
    });

    it("should ignore branches without id", () => {
        const previous: BranchSnapshot[] = [createSnapshotItem("1")];
        const current: BranchLike[] = [
            createBranch("1"),
            { name: "No ID Branch", status: "Опубликовано" }, // no id
        ];

        const result = compareBranchLists(previous, current);

        expect(result.added).toHaveLength(0);
        expect(result.removed).toHaveLength(0);
    });

    it("should handle large lists efficiently", () => {
        const previous: BranchSnapshot[] = Array.from({ length: 1000 }, (_, i) => createSnapshotItem(String(i)));
        const current: BranchLike[] = [
            ...Array.from({ length: 999 }, (_, i) => createBranch(String(i))),
            createBranch("1001", "New Branch"),
        ];

        const startTime = Date.now();
        const result = compareBranchLists(previous, current);
        const elapsed = Date.now() - startTime;

        expect(result.added).toHaveLength(1);
        expect(result.added[0].id).toBe("1001");
        expect(result.removed).toHaveLength(1);
        expect(result.removed[0].id).toBe("999");
        expect(elapsed).toBeLessThan(100); // Should be fast
    });
});

describe("createSnapshot", () => {
    it("should create snapshot from branches", () => {
        const branches: BranchLike[] = [
            { id: "1", name: "Branch 1", address: "Address 1", status: "Опубликовано" },
            { id: "2", name: "Branch 2", address: "Address 2", status: "published" },
        ];

        const snapshot = createSnapshot(branches);

        expect(snapshot).toHaveLength(2);
        expect(snapshot[0]).toEqual({ id: "1", name: "Branch 1", address: "Address 1" });
        expect(snapshot[1]).toEqual({ id: "2", name: "Branch 2", address: "Address 2" });
    });

    it("should filter out non-published branches", () => {
        const branches: BranchLike[] = [
            { id: "1", name: "Published", status: "Опубликовано" },
            { id: "2", name: "Closed", status: "Закрыт" },
            { id: "3", name: "Draft", status: "На модерации" },
        ];

        const snapshot = createSnapshot(branches);

        expect(snapshot).toHaveLength(1);
        expect(snapshot[0].id).toBe("1");
    });

    it("should filter out branches without id", () => {
        const branches: BranchLike[] = [
            { id: "1", name: "With ID" },
            { name: "Without ID" },
        ];

        const snapshot = createSnapshot(branches);

        expect(snapshot).toHaveLength(1);
        expect(snapshot[0].id).toBe("1");
    });

    it("should handle empty input", () => {
        const snapshot = createSnapshot([]);
        expect(snapshot).toHaveLength(0);
    });
});

describe("PUBLISHED_STATUSES", () => {
    it("should contain expected statuses", () => {
        expect(PUBLISHED_STATUSES).toContain("Опубликовано");
        expect(PUBLISHED_STATUSES).toContain("published");
        expect(PUBLISHED_STATUSES).toContain("active");
    });
});
