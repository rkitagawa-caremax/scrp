import fetch from 'node-fetch';
import { PREFECTURES, SERVICE_TYPES } from '../utils/prefectures.js';
import { dedupeRecords } from './record-normalizer.js';

const REQUEST_DELAY_MS = 700;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const PAGE_SIZE = 50; // kaigokensaku accepts 5/10/30/50
const MAX_PAGES_PER_PREF = 3000;
const SORT_NAME = 'JigyosyoCd';
const SORT_ORDER = 0;
const WEB_SOURCE = 'kaigokensaku.mhlw.go.jp(api)';

const BASE_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
};

// Frontend service ids -> kaigokensaku service codes.
const SERVICE_ID_TO_CODES = {
    houmon_kaigo: ['110'],
    houmon_nyuyoku: ['120'],
    houmon_kango: ['130'],
    houmon_rehab: ['140'],
    tsusho_kaigo: ['150', '155', '720', '780'],
    tsusho_rehab: ['160'],
    tanki_seikatsu: ['210'],
    tanki_ryoyo: ['220', '230', '551'],
    tokutei_shisetsu: ['331', '332', '334', '335', '336', '337', '361', '362', '364'],
    fukushi_yogu: ['170', '410'],
    kaigo_rojin_fukushi: ['510', '540'],
    kaigo_rojin_hoken: ['520'],
    kaigo_iryoin: ['530', '550'],
    ninchi_group: ['320'],
    kyotaku_shien: ['430'],
    chiiki_houkatsu: ['730', '760', '770'],
};

const SERVICE_CODE_TO_ID = buildServiceCodeToIdMap();
const SERVICE_NAME_BY_ID = new Map(SERVICE_TYPES.map((service) => [service.id, service.name]));

/**
 * Fetch records by using the official search AJAX endpoint behind list pages.
 */
export async function scrapeWebData(prefectureCodes, serviceTypeIds, onProgress) {
    const selectedPrefs = PREFECTURES.filter((pref) => prefectureCodes.includes(pref.code));
    const selectedServiceCodes = buildSelectedServiceCodeSet(serviceTypeIds);

    if (selectedPrefs.length === 0) {
        return [];
    }
    if (selectedServiceCodes.size === 0) {
        throw new Error('サービス種別のコード変換に失敗しました。選択条件を見直してください。');
    }

    const results = [];
    let completedPrefs = 0;

    for (const pref of selectedPrefs) {
        onProgress?.({
            phase: 'scrape',
            message: `${pref.name} の一覧AJAXを取得中...`,
            progress: Math.round((completedPrefs / selectedPrefs.length) * 100),
        });

        try {
            const prefResults = await scrapePrefecture(pref, selectedServiceCodes, onProgress);
            results.push(...prefResults);

            onProgress?.({
                phase: 'scrape',
                message: `${pref.name}: ${prefResults.length.toLocaleString()}件`,
                progress: Math.round(((completedPrefs + 1) / selectedPrefs.length) * 100),
            });
        } catch (error) {
            onProgress?.({
                phase: 'error',
                message: `${pref.name} の取得失敗: ${error.message}`,
                progress: Math.round(((completedPrefs + 1) / selectedPrefs.length) * 100),
            });
        }

        completedPrefs += 1;
        await delay(REQUEST_DELAY_MS);
    }

    return dedupeRecords(results);
}

async function scrapePrefecture(pref, selectedServiceCodes, onProgress) {
    const baseUrl = `https://www.kaigokensaku.mhlw.go.jp/${pref.code}/index.php`;
    const listUrl = `${baseUrl}?action_kouhyou_pref_search_list_list=true`;
    const cookies = new Map();

    // 1) Open list page first to initialize PHP session + search cache.
    const listResponse = await fetchWithRetry(listUrl, {
        headers: buildHtmlHeaders(''),
    });
    mergeCookies(cookies, getSetCookieHeaders(listResponse));
    await listResponse.text();

    // 2) Pull pages through the same AJAX endpoint used by the website.
    const prefResults = [];
    let offset = 0;
    let page = 0;

    while (page < MAX_PAGES_PER_PREF) {
        const cookieHeader = buildCookieHeader(cookies);
        const ajaxUrl = buildSearchAjaxUrl(baseUrl, offset);

        const response = await fetchWithRetry(ajaxUrl, {
            headers: buildAjaxHeaders(listUrl, cookieHeader),
        });
        mergeCookies(cookies, getSetCookieHeaders(response));

        const payload = await parseJsonResponse(response, pref.name, offset);
        if (payload.status !== 'success') {
            throw new Error(
                typeof payload.data === 'string' && payload.data
                    ? payload.data
                    : '検索APIの応答が異常です'
            );
        }

        const rows = Array.isArray(payload.data) ? payload.data : [];
        if (rows.length === 0) {
            break;
        }

        for (const row of rows) {
            const serviceCode = normalizeServiceCode(row?.ServiceCd);
            if (!selectedServiceCodes.has(serviceCode)) continue;
            prefResults.push(mapRecord(row, pref.name, serviceCode));
        }

        page += 1;
        onProgress?.({
            phase: 'scrape',
            message: `${pref.name}: ${Math.min(offset + rows.length, Number(payload.pager?.total || 0)).toLocaleString()}件処理`,
            progress: -1,
        });

        const nextOffset = getNextOffset(payload.pager, offset);
        if (nextOffset === null) break;
        offset = nextOffset;

        await delay(REQUEST_DELAY_MS);
    }

    return prefResults;
}

function buildSelectedServiceCodeSet(serviceTypeIds) {
    const serviceCodes = new Set();
    for (const serviceTypeId of serviceTypeIds || []) {
        for (const code of SERVICE_ID_TO_CODES[serviceTypeId] || []) {
            serviceCodes.add(normalizeServiceCode(code));
        }
    }
    return serviceCodes;
}

function buildServiceCodeToIdMap() {
    const map = new Map();
    for (const [serviceId, codes] of Object.entries(SERVICE_ID_TO_CODES)) {
        for (const code of codes) {
            const normalized = normalizeServiceCode(code);
            if (!map.has(normalized)) {
                map.set(normalized, serviceId);
            }
        }
    }
    return map;
}

function buildSearchAjaxUrl(baseUrl, offset) {
    const params = new URLSearchParams({
        action_kouhyou_pref_search_search: 'true',
        method: 'search',
        p_count: String(PAGE_SIZE),
        p_offset: String(offset),
        p_sort_name: SORT_NAME,
        p_order: String(SORT_ORDER),
    });
    return `${baseUrl}?${params.toString()}`;
}

function buildHtmlHeaders(cookieHeader) {
    const headers = {
        ...BASE_HEADERS,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (cookieHeader) headers.Cookie = cookieHeader;
    return headers;
}

function buildAjaxHeaders(referer, cookieHeader) {
    const headers = {
        ...BASE_HEADERS,
        Accept: 'application/json,text/javascript,*/*;q=0.1',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: referer,
    };
    if (cookieHeader) headers.Cookie = cookieHeader;
    return headers;
}

function getSetCookieHeaders(response) {
    return response.headers.raw()['set-cookie'] || [];
}

function mergeCookies(cookieMap, setCookieHeaders) {
    for (const line of setCookieHeaders || []) {
        const pair = String(line).split(';')[0];
        const index = pair.indexOf('=');
        if (index <= 0) continue;
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!name) continue;
        cookieMap.set(name, value);
    }
}

function buildCookieHeader(cookieMap) {
    if (!cookieMap || cookieMap.size === 0) return '';
    return [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function getNextOffset(pager, currentOffset) {
    if (!pager || typeof pager !== 'object') return null;
    const next = Number(pager.next);
    if (!Number.isFinite(next)) return null;
    if (next < 0 || next <= currentOffset) return null;
    return next;
}

async function parseJsonResponse(response, prefName, offset) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        const snippet = text.slice(0, 140).replace(/\s+/g, ' ').trim();
        throw new Error(
            `${prefName} offset=${offset} のJSON解析に失敗しました: ${snippet || 'empty response'}`
        );
    }
}

function mapRecord(row, prefName, serviceCode) {
    const serviceId = SERVICE_CODE_TO_ID.get(serviceCode) || '';
    const serviceName = SERVICE_NAME_BY_ID.get(serviceId) || serviceCode;

    return {
        prefecture: prefName,
        jigyoushoNumber: buildJigyoushoNumber(row?.JigyosyoCd, row?.JigyosyoSubCd),
        name: normalizeText(row?.JigyosyoName),
        postalCode: normalizePostalCode(row?.JigyosyoYubinbangou),
        address: normalizeText(row?.JigyosyoJyusho),
        phone: normalizePhone(row?.JigyosyoTel),
        fax: normalizePhone(row?.JigyosyoFax),
        serviceType: serviceName,
        corporateName: normalizeText(row?.HoujinName),
        corporateType: normalizeText(row?.HoujinType),
        userCount: normalizeUserCount(row?.TotalUserNum),
        sourceSite: WEB_SOURCE,
    };
}

function buildJigyoushoNumber(code, subCode) {
    const base = normalizeText(code).replace(/[^\d]/g, '');
    const sub = normalizeText(subCode).replace(/[^\d]/g, '');
    if (!base) return '';
    if (!sub || sub === '00') return base;
    return `${base}-${sub}`;
}

function normalizeServiceCode(value) {
    return normalizeText(value).replace(/[^\d]/g, '');
}

function normalizePostalCode(value) {
    const text = normalizeText(value);
    if (!text) return '';

    const digits = text.replace(/[^\d]/g, '');
    if (digits.length === 7) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    }
    return text.replace(',', '-');
}

function normalizePhone(value) {
    return normalizeText(value).replace(/[―ーｰ‐−]/g, '-');
}

function normalizeUserCount(value) {
    const digits = normalizeText(value).replace(/[^\d]/g, '');
    return digits || '';
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                redirect: 'follow',
            });

            if (!response.ok) {
                if (response.status === 429 && attempt < retries - 1) {
                    await delay(REQUEST_DELAY_MS * (attempt + 2));
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            return response;
        } catch (error) {
            if (attempt === retries - 1) {
                throw error;
            }
            await delay(REQUEST_DELAY_MS * (attempt + 1));
        } finally {
            clearTimeout(timer);
        }
    }

    throw new Error('HTTP request failed');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
