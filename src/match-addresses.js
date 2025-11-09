// src/match-addresses.js
// node ./src/match-addresses.js

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseStringPromise } from 'xml2js';
import stringSimilarity from 'string-similarity';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_FILE = path.resolve(__dirname, '../data/branches.json');
const XML_FILE = path.resolve(__dirname, '../For_Yandexx_Map.xml');
const OUTPUT_MISMATCH_XML = path.resolve(__dirname, '../data/not-matched.xml');

// жёсткий порог — строками похоже
const STRICT_THRESHOLD = 0.83;
// мягкий порог — строками не идеально, но можно добить проверкой улицы/дома
const WEAK_THRESHOLD = 0.73;

// то, что хотим выбрасывать из обеих адресных строк
const TRASH = [
  'северо-западный федеральный округ',
  'ленинградская область',
  'санкт-петербург',
  'санкт петербург',
  'россия',
  'спб',
  'городской посёлок',
  'городское поселение',
  'сельское поселение',
  'муниципальный округ',
  'территория',
  'микрорайон',
  'район'
];

// приводим сокращения к одному виду
function unifyAbbr(s) {
  return s
    // длинные сначала
    .replace(/бул\./g, 'бульвар')
    .replace(/просп\./g, 'проспект')
    .replace(/пр-кт/g, 'проспект')
    .replace(/пр-т/g, 'проспект')
    .replace(/пр\./g, 'проспект')
    .replace(/ш\./g, 'шоссе')
    .replace(/пл\./g, 'площадь')
    .replace(/пер\./g, 'переулок')
    .replace(/ул\./g, 'улица')
    .replace(/ул /g, 'улица ');
}

// общая нормализация для обеих сторон
function normalize(str) {
  if (!str) return '';
  let s = str.toLowerCase().replace(/ё/g, 'е').trim();

  s = unifyAbbr(s);

  // убрать головы
  s = s.replace(/^россия,?\s*/g, '');
  s = s.replace(/^северо-западный федеральный округ,?\s*/g, '');
  s = s.replace(/^ленинградская область,?\s*/g, '');
  s = s.replace(/^санкт-петербург\s*г[.,]?\s*/g, '');
  s = s.replace(/^санкт-петербург,?\s*/g, '');
  s = s.replace(/^спб,?\s*/g, '');

  // выкинуть частые административные слова
  TRASH.forEach(t => {
    const re = new RegExp('\\b' + t + '\\b', 'g');
    s = s.replace(re, '');
  });

  // привести "35к1" и "35 к 1" к одному шаблону
  s = s.replace(/(\d+)\s*к\s*(\d+)/g, '$1 корп $2');
  s = s.replace(/(\d+)к(\d+)/g, '$1 корп $2');

  // иногда в xml: ", 23, 2" — это корп 2
  s = s.replace(/,\s*(\d+),\s*(\d+)(?!\d)/g, ', $1, корп $2');

  // унифицируем эти части
  s = s
    .replace(/корпус/g, 'корп')
    .replace(/корп\./g, 'корп')
    .replace(/строение/g, 'стр')
    .replace(/стр\./g, 'стр')
    .replace(/лит\./g, 'лит');

  // а теперь вообще уберём хвосты с корп/стр/лит/пом — они в базах по-разному
  s = s.replace(/,?\s*(корп|стр|лит|пом|оф)\s*[\w-]+/g, '');

  // нормализуем запятые
  s = s.replace(/\s*,\s*/g, ', ');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^,/, '').replace(/,$/, '').trim();

  return s;
}

// выдёргиваем «основную улицу» из нормализованной строки
function extractStreet(norm) {
  // ищем по ключевым словам
  const m = norm.match(/(улица|проспект|бульвар|шоссе|переулок|площадь|дорога|проспект героев|приморское шоссе)\s+([^,]+)/);
  if (m) {
    return m[0].trim(); // целиком "улица такая-то"
  }
  // fallback — до первой запятой
  const firstComma = norm.split(',')[0];
  return firstComma.trim();
}

// выдёргиваем дом (первое число в строке)
function extractHouse(norm) {
  const m = norm.match(/(\d+[а-яa-z]?)/i);
  return m ? m[1].toLowerCase() : '';
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function main() {
  // 1. читаем "правильный" JSON
  const jsonRaw = readFileSync(JSON_FILE, 'utf8');
  const jsonData = JSON.parse(jsonRaw);

  const jsonAddresses = jsonData
    .filter(x => x.address)
    .map(x => {
      const norm = normalize(x.address);
      return {
        id: x.id,
        raw: x.address,
        norm,
        street: extractStreet(norm),
        house: extractHouse(norm)
      };
    });

  // 2. читаем XML
  const xmlRaw = readFileSync(XML_FILE, 'utf8');
  const xmlData = await parseStringPromise(xmlRaw, { explicitArray: false });

  const companies = xmlData.companies.company;
  const xmlList = Array.isArray(companies) ? companies : [companies];

  const xmlAddresses = xmlList
    .map(c => {
      let addr = null;
      if (c.address) {
        if (typeof c.address === 'string') {
          addr = c.address;
        } else if (c.address._) {
          addr = c.address._;
        }
      }
      return addr;
    })
    .filter(Boolean)
    .map(a => {
      const norm = normalize(a);
      return {
        raw: a,
        norm,
        street: extractStreet(norm),
        house: extractHouse(norm)
      };
    });

  // отдельный массив норм-строк для быстрого поиска
  const xmlNorms = xmlAddresses.map(a => a.norm);

  let matches = 0;
  const detailed = [];
  const notMatched = [];

  for (const j of jsonAddresses) {
    // ищем лучший xml по строковому сходству
    const { bestMatch, ratings } = stringSimilarity.findBestMatch(j.norm, xmlNorms);
    const bestScore = bestMatch.rating;
    const bestIndex = ratings.findIndex(r => r.rating === bestScore);
    const bestXml = bestIndex >= 0 ? xmlAddresses[bestIndex] : null;

    let isMatch = false;

    if (bestXml) {
      if (bestScore >= STRICT_THRESHOLD) {
        // прям хорошо
        isMatch = true;
      } else if (bestScore >= WEAK_THRESHOLD) {
        // пробуем «по-умному»: улица + дом
        const streetOk =
          j.street &&
          bestXml.street &&
          (bestXml.street.includes(j.street) || j.street.includes(bestXml.street));

        const houseOk =
          j.house &&
          bestXml.house &&
          j.house === bestXml.house;

        if (streetOk && houseOk) {
          isMatch = true;
        }
      }
    }

    if (isMatch) {
      matches++;
      detailed.push({
        jsonId: j.id,
        json: j.raw,
        xml: bestXml.raw,
        score: Number(bestScore.toFixed(3))
      });
    } else {
      notMatched.push({
        jsonId: j.id,
        json: j.raw,
        norm: j.norm,
        bestScore: bestXml ? Number(bestScore.toFixed(3)) : 0,
        bestXml: bestXml ? bestXml.raw : null
      });
    }
  }

  console.log('Всего адресов в JSON:', jsonAddresses.length);
  console.log(`Нашли соответствие в XML: ${matches}`);

  detailed.forEach(d => {
    console.log(
      `[${d.score}] JSON: ${d.json} (id=${d.jsonId})  <--->  XML: ${d.xml}`
    );
  });

  if (notMatched.length > 0) {
    console.log('\nНе нашли соответствий для JSON (показываю лучший XML-кандидат):');
    notMatched.forEach(nm => {
      console.log(`- ${nm.json} (id=${nm.jsonId})`);
      if (nm.bestXml) {
        console.log(`    → лучший XML (${nm.bestScore}): ${nm.bestXml}`);
      } else {
        console.log('    → в XML ничего похожего');
      }
    });
  }

  const mismatchXml = ['<?xml version="1.0" encoding="UTF-8"?>', '<notMatched>'];
  notMatched.forEach(nm => {
    mismatchXml.push('  <entry>');
    mismatchXml.push(`    <jsonId>${escapeXml(String(nm.jsonId ?? ''))}</jsonId>`);
    mismatchXml.push(`    <jsonAddress>${escapeXml(nm.json)}</jsonAddress>`);
    mismatchXml.push(`    <normalized>${escapeXml(nm.norm)}</normalized>`);
    mismatchXml.push(`    <bestScore>${nm.bestScore}</bestScore>`);
    if (nm.bestXml) {
      mismatchXml.push(`    <bestXml>${escapeXml(nm.bestXml)}</bestXml>`);
    }
    mismatchXml.push('  </entry>');
  });
  mismatchXml.push('</notMatched>');

  writeFileSync(OUTPUT_MISMATCH_XML, mismatchXml.join('\n'), 'utf8');
  console.log(`\nНесовпадения сохранены в ${path.relative(process.cwd(), OUTPUT_MISMATCH_XML)}`);
}

main().catch(console.error);
