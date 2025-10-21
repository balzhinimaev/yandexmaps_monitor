import axios from "axios";
import { getDistance } from "geolib";
import { env } from "./config.js";

export type YOrg = {
    id?: string; // CompanyMetaData.id
    name?: string;
    address?: string;
    lat: number;
    lon: number;
    hoursText?: string;
    hoursAvail?: any;
    url?: string; // ссылка на карточку в картах
};

export async function searchCandidates(opts: { lat: number; lon: number; address: string; queryName?: string }) {
    const { lat, lon, address, queryName = "" } = opts;
    const base = "https://search-maps.yandex.ru/v1";
    const common = {
        apikey: env.YANDEX_API_KEY,
        type: "biz",
        lang: env.YMAPS_LANG,
        results: env.YMAPS_RESULTS,
    } as const;

    console.log(`\n🔍 Поиск организации:`);
    console.log(`  Адрес: ${address}`);
    console.log(`  Координаты: ${lat}, ${lon}`);
    console.log(`  Название: ${queryName || "(не указано)"}`);

    // 1) По адресу (надежнее текстового совпадения)
    const byAddrParams = { ...common, text: address };
    console.log(`\n📍 Запрос 1 (по адресу):`);
    console.log(`  URL: ${base}`);
    console.log(`  Params:`, JSON.stringify(byAddrParams, null, 2));

    const byAddr = await axios
        .get(base, {
            params: byAddrParams,
            timeout: env.HTTP_TIMEOUT_MS,
        })
        .then((r) => {
            console.log(`  ✅ Ответ: найдено ${r.data?.features?.length || 0} объектов`);
            if (r.data?.features?.length > 0) {
                console.log(`  Первый результат:`, JSON.stringify(r.data.features[0]?.properties?.name, null, 2));
            }
            return r.data;
        })
        .catch((err) => {
            console.log(`  ❌ Ошибка:`, err.response?.status, err.response?.data || err.message);
            return null;
        });

    // 2) По координатам + опционально по названию
    const byGeoParams = {
        ...common,
        ll: `${lon},${lat}`,
        spn: "0.005,0.005",
        text: queryName || address,
    };
    console.log(`\n📍 Запрос 2 (по координатам):`);
    console.log(`  URL: ${base}`);
    console.log(`  Params:`, JSON.stringify(byGeoParams, null, 2));

    const byGeo = await axios
        .get(base, {
            params: byGeoParams,
            timeout: env.HTTP_TIMEOUT_MS,
        })
        .then((r) => {
            console.log(`  ✅ Ответ: найдено ${r.data?.features?.length || 0} объектов`);
            if (r.data?.features?.length > 0) {
                console.log(`  Первый результат:`, JSON.stringify(r.data.features[0]?.properties?.name, null, 2));
            }
            return r.data;
        })
        .catch((err) => {
            console.log(`  ❌ Ошибка:`, err.response?.status, err.response?.data || err.message);
            return null;
        });

    const features = [...(byAddr?.features || []), ...(byGeo?.features || [])];
    console.log(`\n📊 Всего найдено уникальных объектов: ${features.length}`);

    // Приводим к удобному виду + сортируем по дистанции
    const uniq = new Map<string, string>();
    const items: YOrg[] = [];
    for (const f of features) {
        const p = f.properties || {};
        const g = f.geometry || {};
        const id = p.CompanyMetaData?.id || p.id || f.id || `${g.coordinates}`;
        if (uniq.has(id)) continue;
        uniq.set(id, "1");
        const [lon0, lat0] = g.coordinates || [null, null];
        const _distance = lat0 && lon0 ? getDistance({ latitude: lat, longitude: lon }, { latitude: lat0, longitude: lon0 }) : 999999;
        items.push({
            id,
            name: p.name,
            address: p.description || p.CompanyMetaData?.address,
            lat: lat0,
            lon: lon0,
            hoursText: p.CompanyMetaData?.Hours?.text,
            hoursAvail: p.CompanyMetaData?.Hours?.Availabilities,
            url: p.CompanyMetaData?.url,
        } as YOrg & { distance: number });
    }
    // @ts-ignore
    items.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    return items;
}

export function pickBest(cands: YOrg[], lat: number, lon: number) {
    console.log(`\n🎯 Выбор лучшего кандидата (макс. расстояние: ${env.MAX_DISTANCE_METERS}м):`);
    console.log(`  Всего кандидатов: ${cands.length}`);

    // Первая, попавшая в радиус
    for (const c of cands) {
        const d = getDistance({ latitude: lat, longitude: lon }, { latitude: c.lat, longitude: c.lon });
        console.log(`  - "${c.name}" (${c.address}): ${d}м от цели`);
        if (d <= env.MAX_DISTANCE_METERS) {
            console.log(`    ✅ Подходит! (в пределах ${env.MAX_DISTANCE_METERS}м)`);
            return c;
        }
    }

    console.log(`  ❌ Ни один кандидат не попал в радиус ${env.MAX_DISTANCE_METERS}м`);
    return null;
}
