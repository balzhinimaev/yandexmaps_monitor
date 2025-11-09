import axios from "axios";
import { env } from "./config.js";
import { XMLParser } from "fast-xml-parser";

export type Company = {
    companyId: string;
    name: string;
    address: string;
    lat: number;
    lon: number;
    workingTime: string; // как в XML
};

function extractText(value: unknown): string {
    if (!value) return "—";
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null) {
        if ("#text" in value) return String(value["#text"]);
        if (Array.isArray(value)) {
            // Если массив объектов, пытаемся извлечь текст из каждого
            return (
                value
                    .map((v) => extractText(v))
                    .filter(Boolean)
                    .join(", ") || "—"
            );
        }
        // Если объект, пытаемся получить значение
        if ("value" in value) return String(value.value);
    }
    return String(value);
}

export async function loadCompanies(): Promise<Company[]> {
    if (!env.XML_URL) {
        throw new Error("XML_URL не задан в конфигурации");
    }
    const { data } = await axios.get(env.XML_URL, {
        timeout: env.HTTP_TIMEOUT_MS,
    });
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        trimValues: true,
    });
    const root = parser.parse(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodes = ([] as any[]).concat(root?.companies?.company || root?.company || []);
    return nodes.map((n) => ({
        companyId: String(n["company-id"] ?? n.companyId ?? n.id),
        name: extractText(n.name),
        address: extractText(n.address),
        lat: Number(n.coordinates?.lat),
        lon: Number(n.coordinates?.lon),
        workingTime: extractText(n["working-time"]),
    }));
}
