import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { PREFECTURES, SERVICE_TYPES } from '../utils/prefectures.js';
import { downloadRecordsFromUrl } from './download-utils.js';
import {
    dedupeRecords,
    filterRecordsByPrefecture,
    mapToStandardFormat,
} from './record-normalizer.js';

/**
 * 厚労省の公開オープンデータ取得
 */
const MHLW_OPENDATA_PAGE = 'https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html';
const MHLW_CONTENT_BASE = 'https://www.mhlw.go.jp/content/12300000';

const SERVICE_CODE_MAP = {
    houmon_kaigo: ['110'],
    houmon_nyuyoku: ['120'],
    houmon_kango: ['130'],
    houmon_rehab: ['140'],
    tsusho_kaigo: ['150', '155'],
    tsusho_rehab: ['160'],
    tanki_seikatsu: ['210'],
    tanki_ryoyo: ['220', '230', '551'],
    tokutei_shisetsu: ['331', '332', '334', '335', '336', '337', '361', '362', '364'],
    fukushi_yogu: ['170'],
    kaigo_rojin_fukushi: ['510', '540'],
    kaigo_rojin_hoken: ['520'],
    kaigo_iryoin: ['550'],
    ninchi_group: ['320'],
    kyotaku_shien: ['430'],
    chiiki_houkatsu: [],
};

const FETCH_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function toAbsoluteUrl(href) {
    try {
        return new URL(href, MHLW_OPENDATA_PAGE).toString();
    } catch {
        return '';
    }
}

function extractServiceCode(linkText, url) {
    const textCode = linkText.match(/^(\d{3})_/);
    if (textCode) return textCode[1];

    const urlCode = url.match(/jigyosho_(\d{3})/i);
    if (urlCode) return urlCode[1];

    return '';
}

function extractTimestampScore(url) {
    const allTimestamp = url.match(/_all_(\d{14})\.(csv|zip)/i);
    if (allTimestamp) return Number(allTimestamp[1]);

    const contentVersion = url.match(/\/(\d{6,})\.(csv|zip)/i);
    if (contentVersion) return Number(contentVersion[1]);

    return 0;
}

function scoreCatalogCandidate(code, url) {
    const lower = url.toLowerCase();
    let score = 0;

    if (lower.includes(`jigyosho_${code}.csv`)) score += 400;
    if (lower.includes(`jigyosho_${code}_all_`) && lower.endsWith('.csv')) score += 350;
    if (lower.endsWith('.csv')) score += 220;
    if (lower.includes('.csv?')) score += 200;
    if (lower.endsWith('.zip')) score += 150;
    if (lower.includes('mhlw.go.jp/content/')) score += 50;

    return score;
}

async function loadOfficialCatalogMap() {
    const response = await fetch(MHLW_OPENDATA_PAGE, { headers: FETCH_HEADERS });
    if (!response.ok) {
        throw new Error(`公式カタログ取得失敗: HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const groupedByCode = new Map();

    $('a[href]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        if (!href) return;

        const absoluteUrl = toAbsoluteUrl(href);
        if (!absoluteUrl || !/\.(csv|zip)(\?|$)/i.test(absoluteUrl)) return;

        const linkText = $(anchor).text().replace(/\s+/g, ' ').trim();
        const code = extractServiceCode(linkText, absoluteUrl);
        if (!code) return;

        const candidate = {
            url: absoluteUrl,
            score: scoreCatalogCandidate(code, absoluteUrl),
            timestampScore: extractTimestampScore(absoluteUrl),
        };

        if (!groupedByCode.has(code)) groupedByCode.set(code, []);
        groupedByCode.get(code).push(candidate);
    });

    const bestByCode = new Map();
    for (const [code, candidates] of groupedByCode.entries()) {
        candidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.timestampScore - a.timestampScore;
        });
        bestByCode.set(code, candidates[0]?.url || '');
    }

    return bestByCode;
}

function buildFallbackCodeUrls(code) {
    return [
        `${MHLW_CONTENT_BASE}/jigyosho_${code}.csv`,
        `${MHLW_CONTENT_BASE}/jigyosho_${code}.zip`,
    ];
}

async function downloadRecordsByCode(code, catalogMap) {
    const candidates = new Set();
    const catalogUrl = catalogMap.get(code);
    if (catalogUrl) candidates.add(catalogUrl);

    for (const fallback of buildFallbackCodeUrls(code)) {
        candidates.add(fallback);
    }

    for (const url of candidates) {
        const records = await downloadRecordsFromUrl(url);
        if (records.length > 0) {
            return records;
        }
    }

    return [];
}

async function downloadOfficialServiceRecords(service, catalogMap, onProgress) {
    const targetCodes = SERVICE_CODE_MAP[service.id] || [];
    if (targetCodes.length === 0) return [];

    const records = [];
    for (const code of targetCodes) {
        onProgress?.({
            phase: 'download',
            progress: -1,
            message: `[公式オープンデータ] ${service.name} (${code}) を取得中...`,
        });

        const codeRecords = await downloadRecordsByCode(code, catalogMap);
        if (codeRecords.length > 0) {
            records.push(...codeRecords);
        }
    }

    return records;
}

/**
 * @param {string[]} prefectureCodes
 * @param {string[]} serviceTypeIds
 * @param {function} onProgress - 進捗コールバック
 * @returns {Promise<object[]>}
 */
export async function fetchOpenData(prefectureCodes, serviceTypeIds, onProgress) {
    const results = [];
    const selectedServices = SERVICE_TYPES.filter((s) => serviceTypeIds.includes(s.id));
    const selectedPrefs = PREFECTURES.filter((p) => prefectureCodes.includes(p.code));
    const totalTasks = selectedServices.length;
    let completedTasks = 0;
    let catalogMap = new Map();

    try {
        catalogMap = await loadOfficialCatalogMap();
        onProgress?.({
            phase: 'download',
            message: `[公式オープンデータ] カタログ取得成功: ${catalogMap.size}種`,
            progress: 0,
        });
    } catch (error) {
        onProgress?.({
            phase: 'error',
            message: `[公式オープンデータ] カタログ取得失敗: ${error.message}`,
            progress: 0,
        });
    }

    for (const service of selectedServices) {
        try {
            onProgress?.({
                phase: 'download',
                message: `[公式オープンデータ] ${service.name} を取得中...`,
                progress: Math.round((completedTasks / totalTasks) * 100),
            });

            const rawRecords = await downloadOfficialServiceRecords(
                service,
                catalogMap,
                onProgress
            );

            if (rawRecords.length > 0) {
                const filteredData = filterRecordsByPrefecture(rawRecords, selectedPrefs);
                const mapped = mapToStandardFormat(filteredData, service.name, {
                    sourceSite: 'mhlw.go.jp',
                });
                results.push(...mapped);

                onProgress?.({
                    phase: 'parse',
                    message: `[公式オープンデータ] ${service.name}: ${mapped.length}件`,
                    progress: Math.round(((completedTasks + 1) / totalTasks) * 100),
                });
            } else {
                onProgress?.({
                    phase: 'error',
                    message: `[公式オープンデータ] ${service.name}: データ未取得`,
                    progress: Math.round(((completedTasks + 1) / totalTasks) * 100),
                });
            }
        } catch (err) {
            onProgress?.({
                phase: 'error',
                message: `[公式オープンデータ] ${service.name}: ${err.message}`,
                progress: Math.round(((completedTasks + 1) / totalTasks) * 100),
            });
        }
        completedTasks++;
    }

    return dedupeRecords(results);
}
