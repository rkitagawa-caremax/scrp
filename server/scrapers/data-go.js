import fetch from 'node-fetch';
import { PREFECTURES, SERVICE_TYPES } from '../utils/prefectures.js';
import { downloadRecordsFromUrl } from './download-utils.js';
import {
    dedupeRecords,
    filterRecordsByPrefecture,
    mapToStandardFormat,
} from './record-normalizer.js';

const DATA_GO_PACKAGE_SEARCH =
    'https://data.e-gov.go.jp/data/api/action/package_search';
const MAX_PACKAGES_PER_QUERY = 60;
const MAX_RESOURCES_PER_SERVICE = 8;
const MAX_DOWNLOADS_PER_SERVICE = 6;

function normalizeText(value) {
    return String(value ?? '').trim();
}

function includesAny(text, words) {
    return words.some((word) => text.includes(word));
}

async function fetchJsonWithRetry(url, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Accept: 'application/json',
                },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            if (attempt === retries - 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    return null;
}

function buildServiceQueries(service) {
    const fileToken = service.opendataFile.replace(/^jigyous(?:yo|ho)_/, '');
    return [
        `介護サービス情報公表システム ${service.name}`,
        `介護 オープンデータ ${service.name}`,
        `介護 ${fileToken}`,
    ];
}

function scorePackage(service, pkg) {
    const text = normalizeText(
        `${pkg.title || ''} ${pkg.notes || ''} ${(pkg.tags || [])
            .map((tag) => tag.display_name || '')
            .join(' ')} ${(pkg.organization && pkg.organization.title) || ''}`
    ).toLowerCase();

    let score = 0;
    if (includesAny(text, ['介護', 'care'])) score += 20;
    if (includesAny(text, ['公表', 'オープンデータ', 'open data'])) score += 20;
    if (text.includes(service.name.toLowerCase())) score += 20;
    if (includesAny(text, ['厚生労働', 'mhlw'])) score += 20;
    if (includesAny(text, ['事業所', '施設'])) score += 10;
    return score;
}

function scoreResource(service, resource) {
    const url = normalizeText(resource.url || resource.download_url).toLowerCase();
    const format = normalizeText(resource.format).toLowerCase();
    const text = normalizeText(
        `${resource.name || ''} ${resource.description || ''} ${format} ${url}`
    ).toLowerCase();
    const token = service.opendataFile
        .replace(/^jigyous(?:yo|ho)_/, '')
        .toLowerCase();

    let score = 0;
    if (format.includes('csv') || format.includes('zip')) score += 20;
    if (url.endsWith('.csv') || url.endsWith('.zip')) score += 20;
    if (url.includes('.csv?') || url.includes('.zip?')) score += 10;
    if (text.includes(service.name.toLowerCase())) score += 20;
    if (text.includes(token)) score += 30;
    if (includesAny(text, ['kaigokensaku', 'mhlw'])) score += 20;
    return score;
}

function collectCandidateResources(service, packages) {
    const bestByUrl = new Map();

    for (const pkg of packages) {
        const pkgScore = scorePackage(service, pkg);
        if (pkgScore < 20) continue;

        for (const resource of pkg.resources || []) {
            const rawUrl = normalizeText(resource.url || resource.download_url);
            if (!/^https?:\/\//i.test(rawUrl)) continue;
            const lowerUrl = rawUrl.toLowerCase();
            const lowerFormat = normalizeText(resource.format).toLowerCase();
            const isTabular =
                lowerFormat.includes('csv') ||
                lowerFormat.includes('zip') ||
                lowerUrl.endsWith('.csv') ||
                lowerUrl.endsWith('.zip') ||
                lowerUrl.includes('.csv?') ||
                lowerUrl.includes('.zip?');
            if (!isTabular) continue;

            const resourceScore = scoreResource(service, resource);
            const score = pkgScore + resourceScore;
            if (score < 40) continue;

            const current = bestByUrl.get(rawUrl);
            if (!current || current.score < score) {
                bestByUrl.set(rawUrl, {
                    url: rawUrl,
                    score,
                    datasetTitle: pkg.title || '',
                });
            }
        }
    }

    return [...bestByUrl.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESOURCES_PER_SERVICE);
}

async function searchDataGoResources(service) {
    const queries = buildServiceQueries(service);
    const packageMap = new Map();

    for (const query of queries) {
        const url =
            `${DATA_GO_PACKAGE_SEARCH}?q=${encodeURIComponent(query)}` +
            `&rows=${MAX_PACKAGES_PER_QUERY}&sort=score+desc`;

        let payload;
        try {
            payload = await fetchJsonWithRetry(url);
        } catch {
            continue;
        }

        if (!payload?.success || !Array.isArray(payload?.result?.results)) continue;

        for (const pkg of payload.result.results) {
            if (!pkg?.id) continue;
            packageMap.set(pkg.id, pkg);
        }
    }

    return collectCandidateResources(service, [...packageMap.values()]);
}

/**
 * data.go.jp から介護関連データを取得して統合
 */
export async function fetchDataGoData(prefectureCodes, serviceTypeIds, onProgress) {
    const results = [];
    const selectedServices = SERVICE_TYPES.filter((s) => serviceTypeIds.includes(s.id));
    const selectedPrefs = PREFECTURES.filter((p) => prefectureCodes.includes(p.code));

    const totalTasks = selectedServices.length || 1;
    let completed = 0;

    for (const service of selectedServices) {
        onProgress?.({
            phase: 'download',
            message: `[data.go.jp] ${service.name} の候補データセット探索中...`,
            progress: Math.round((completed / totalTasks) * 100),
        });

        const resources = await searchDataGoResources(service);
        if (resources.length === 0) {
            completed += 1;
            onProgress?.({
                phase: 'error',
                message: `[data.go.jp] ${service.name}: 候補リソースなし`,
                progress: Math.round((completed / totalTasks) * 100),
            });
            continue;
        }

        const serviceResults = [];
        const targets = resources.slice(0, MAX_DOWNLOADS_PER_SERVICE);

        for (const resource of targets) {
            onProgress?.({
                phase: 'download',
                message: `[data.go.jp] ${service.name}: ${resource.datasetTitle || resource.url}`,
                progress: -1,
            });

            const rawRecords = await downloadRecordsFromUrl(resource.url);
            if (rawRecords.length === 0) continue;

            const filtered = filterRecordsByPrefecture(rawRecords, selectedPrefs);
            const mapped = mapToStandardFormat(filtered, service.name, {
                sourceSite: 'data.go.jp',
            });
            serviceResults.push(...mapped);
        }

        const deduped = dedupeRecords(serviceResults);
        results.push(...deduped);

        completed += 1;
        onProgress?.({
            phase: 'parse',
            message: `[data.go.jp] ${service.name}: ${deduped.length}件`,
            progress: Math.round((completed / totalTasks) * 100),
        });
    }

    return dedupeRecords(results);
}
