import { promises as fs } from "fs";

export type Mapping = Record<string, string>; // companyId -> yandexId

export async function loadMapping(path: string): Promise<Mapping> {
    try {
        return JSON.parse(await fs.readFile(path, "utf8"));
    } catch {
        return {};
    }
}

export async function saveMapping(path: string, map: Mapping) {
    await fs.mkdir(new URL(".", `file://${path}`), { recursive: true }).catch(() => {});
    await fs.writeFile(path, JSON.stringify(map, null, 2), "utf8");
}

export async function saveLastRun(path: string, data: any) {
    await fs.mkdir(new URL(".", `file://${path}`), { recursive: true }).catch(() => {});
    await fs.writeFile(path, JSON.stringify(data, null, 2), "utf8");
}
