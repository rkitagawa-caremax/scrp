import { useCallback, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { PREFECTURES, REGIONS, SERVICE_TYPES } from '../data/masterData.js';

const PAGE_SIZE = 50;
const RAW_API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').trim();
const DEFAULT_REMOTE_API_BASE = 'https://scrp-5na6.onrender.com';
const JOB_POLL_INTERVAL_MS = 2000;
const JOB_POLL_TIMEOUT_MS = 45 * 60 * 1000;
const JOB_NOT_FOUND_RETRY_LIMIT = 20;
const MAX_SERVICE_SELECTION = 4;
const SERVICE_BATCH_SIZE = 1;
const LEGACY_RECOVERY_POLL_INTERVAL_MS = 3000;
const LEGACY_RECOVERY_TIMEOUT_MS = 12 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 45 * 1000;
const REQUEST_RETRY_LIMIT = 3;
const JOB_STATUS_MAX_LOGS = 80;
const EXCEL_EXPORT_COLUMNS = [
    { key: 'prefecture', header: 'prefecture', width: 10 },
    { key: 'businessNumber', header: 'businessNumber', width: 14 },
    { key: 'name', header: 'name', width: 30 },
    { key: 'postalCode', header: 'postalCode', width: 12 },
    { key: 'address', header: 'address', width: 40 },
    { key: 'phone', header: 'phone', width: 16 },
    { key: 'fax', header: 'fax', width: 16 },
    { key: 'userCount', header: 'userCount', width: 12 },
    { key: 'serviceType', header: 'serviceType', width: 20 },
    { key: 'corporateName', header: 'corporateName', width: 30 },
    { key: 'corporateType', header: 'corporateType', width: 14 },
];
const API_BASE = (() => {
    const normalized = RAW_API_BASE.replace(/\/+$/, '');
    if (normalized) return normalized;

    if (typeof window !== 'undefined') {
        const host = String(window.location.hostname || '').toLowerCase();
        if (host !== 'localhost' && host !== '127.0.0.1') {
            return DEFAULT_REMOTE_API_BASE;
        }
    }

    return '';
})();

function buildApiUrl(path) {
    const normalizedPath = path?.startsWith('/') ? path : `/${path || ''}`;
    if (!API_BASE) return normalizedPath;

    try {
        const baseUrl = new URL(API_BASE, window.location.origin);
        const basePath = baseUrl.pathname.replace(/\/+$/, '');
        const baseEndsWithApi = /\/api$/i.test(basePath);
        const pathStartsWithApi = /^\/api(\/|$)/i.test(normalizedPath);

        let finalPath = normalizedPath;
        if (baseEndsWithApi && pathStartsWithApi) {
            finalPath = normalizedPath.replace(/^\/api/i, '') || '/';
        }

        return `${baseUrl.origin}${basePath}${finalPath}`;
    } catch {
        if (API_BASE.endsWith('/api') && /^\/api(\/|$)/i.test(normalizedPath)) {
            return `${API_BASE}${normalizedPath.replace(/^\/api/i, '') || '/'}`;
        }
        return `${API_BASE}${normalizedPath}`;
    }
}

function isLocalHostname(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isLocalApiTarget() {
    if (API_BASE) {
        try {
            const url = new URL(API_BASE, window.location.origin);
            return isLocalHostname(url.hostname);
        } catch {
            return /localhost|127\.0\.0\.1/.test(API_BASE);
        }
    }

    if (typeof window === 'undefined') return false;
    return isLocalHostname(window.location.hostname);
}

function normalizeNetworkErrorMessage(error) {
    const text = String(error?.message || '');
    if (/failed to fetch|networkerror|network request failed/i.test(text)) {
        if (isLocalApiTarget()) {
            return (
                'APIに接続できません。"npm run server" を起動しているか確認してください。' +
                ` 接続先: ${buildApiUrl('/api/health')}`
            );
        }
        return (
            'APIに接続できません。デプロイ先APIのURL設定とバックエンドの稼働を確認してください。' +
            ` 接続先: ${buildApiUrl('/api/health')}`
        );
    }
    return text || '通信エラーが発生しました。';
}
function pushDownloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function readFileNameFromDisposition(headerValue, fallbackName) {
    if (!headerValue) return fallbackName;
    const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);

    const normalMatch = headerValue.match(/filename="?([^"]+)"?/i);
    return normalMatch?.[1] || fallbackName;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status) {
    return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function isTimeoutError(error) {
    const text = String(error?.message || '');
    return (
        error?.code === 'ETIMEDOUT' ||
        /timeout|timed out|abort|aborted|AbortError/i.test(text)
    );
}

function computeRetryDelayMs(attempt, baseDelayMs = 900) {
    const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(8000, exponential + jitter);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const upstreamSignal = options?.signal;
    let timedOut = false;
    let timer = null;

    const onAbortFromUpstream = () => controller.abort();
    if (upstreamSignal) {
        if (upstreamSignal.aborted) {
            controller.abort();
        } else {
            upstreamSignal.addEventListener('abort', onAbortFromUpstream, { once: true });
        }
    }

    if (timeoutMs > 0) {
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
    }

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (timedOut) {
            const timeoutError = new Error(`request timeout (${timeoutMs}ms)`);
            timeoutError.code = 'ETIMEDOUT';
            throw timeoutError;
        }
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
        if (upstreamSignal) {
            upstreamSignal.removeEventListener('abort', onAbortFromUpstream);
        }
    }
}

async function fetchWithRetry(url, options = {}, config = {}) {
    const retries = Math.max(0, Number(config?.retries) || REQUEST_RETRY_LIMIT);
    const timeoutMs = Math.max(1, Number(config?.timeoutMs) || REQUEST_TIMEOUT_MS);
    const baseDelayMs = Math.max(100, Number(config?.baseDelayMs) || 900);
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const response = await fetchWithTimeout(url, options, timeoutMs);
            if (response.ok || !isRetryableHttpStatus(response.status) || attempt >= retries) {
                return response;
            }

            const retryAfterSec = Number.parseInt(
                String(response.headers.get('Retry-After') || '0'),
                10
            );
            const retryAfterMs =
                Number.isFinite(retryAfterSec) && retryAfterSec > 0
                    ? Math.min(12000, retryAfterSec * 1000)
                    : 0;
            const delayMs = retryAfterMs || computeRetryDelayMs(attempt + 1, baseDelayMs);
            await wait(delayMs);
        } catch (error) {
            lastError = error;
            if (
                attempt >= retries ||
                (!isLikelyNetworkDisconnect(error) && !isTimeoutError(error))
            ) {
                throw error;
            }
            await wait(computeRetryDelayMs(attempt + 1, baseDelayMs));
        }
    }

    if (lastError) throw lastError;
    throw new Error('request failed');
}

function chunkArray(items, chunkSize) {
    const safeChunkSize = Math.max(1, Number(chunkSize) || 1);
    const chunks = [];
    for (let i = 0; i < items.length; i += safeChunkSize) {
        chunks.push(items.slice(i, i + safeChunkSize));
    }
    return chunks;
}

function isLikelyNetworkDisconnect(error) {
    const text = String(error?.message || '');
    return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(
        text
    );
}

function normalizeUserCountForExport(item) {
    const candidates = [
        item?.userCount,
        item?.totalUserNum,
        item?.TotalUserNum,
        item?.user_count,
    ];
    const first = candidates.find(
        (value) => value !== undefined && value !== null && String(value).trim() !== ''
    );
    if (first === undefined) return '';
    const digits = String(first).replace(/[^\d]/g, '');
    return digits || String(first).trim();
}

function toExportRecord(item) {
    return {
        prefecture: item?.prefecture || '',
        businessNumber: item?.jigyoushoNumber || item?.businessNumber || '',
        name: item?.name || '',
        postalCode: item?.postalCode || '',
        address: item?.address || '',
        phone: item?.phone || '',
        fax: item?.fax || '',
        userCount: normalizeUserCountForExport(item),
        serviceType: item?.serviceType || '',
        corporateName: item?.corporateName || '',
        corporateType: item?.corporateType || '',
    };
}

function buildExcelBlob(records) {
    const rows = records.map((item) => {
        const normalized = toExportRecord(item);
        return EXCEL_EXPORT_COLUMNS.map((col) => normalized[col.key] || '');
    });
    const headers = EXCEL_EXPORT_COLUMNS.map((col) => col.header);

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    worksheet['!cols'] = EXCEL_EXPORT_COLUMNS.map((col) => ({ wch: col.width }));
    XLSX.utils.book_append_sheet(workbook, worksheet, 'sheet1');

    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    return new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
}

async function parseJsonResponse(response, endpointForError) {
    const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
        const head = (await response.text()).slice(0, 120).replace(/\s+/g, ' ');
        throw new Error(
            `APIレスポンス形式が不正です: ${endpointForError} (${contentType || 'unknown'}) ${head}`
        );
    }
    return response.json();
}

async function readErrorMessageFromResponse(response, endpointForError = '') {
    const status = Number.parseInt(String(response?.status || 0), 10) || 0;
    const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
        try {
            const payload = await response.json();
            const message = String(payload?.error || payload?.message || '').trim();
            if (message) return message;
        } catch {
            // ignore json parse error and fall through
        }
    }

    if (contentType.startsWith('text/')) {
        try {
            const text = (await response.text()).slice(0, 160).replace(/\s+/g, ' ').trim();
            if (text) return `HTTP ${status}: ${text}`;
        } catch {
            // ignore text parse error and fall through
        }
    }

    return `HTTP ${status}${endpointForError ? ` (${endpointForError})` : ''}`;
}

export function useScraper() {
    const [prefectures] = useState(PREFECTURES);
    const [regions] = useState(REGIONS);
    const [serviceTypes] = useState(SERVICE_TYPES);

    const [results, setResults] = useState([]);
    const [totalResults, setTotalResults] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState({ message: '', progress: 0, phase: '' });
    const [logs, setLogs] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');

    const activeJobIdRef = useRef('');

    const appendLog = useCallback((data) => {
        setLogs((prev) => {
            const newLogs = [
                ...prev,
                { time: new Date().toLocaleTimeString(), ...data },
            ];
            return newLogs.slice(-120);
        });
    }, []);

    const fetchData = useCallback(
        async (page, overrideSearch, overrideJobId) => {
            const search = overrideSearch ?? searchQuery;
            const jobId = overrideJobId ?? activeJobIdRef.current;
            const params = new URLSearchParams({
                page: String(page),
                limit: String(PAGE_SIZE),
            });
            if (search) params.set('search', search);
            if (jobId) params.set('jobId', jobId);

            const endpoint = `/api/data?${params.toString()}`;
            try {
                const endpointUrl = buildApiUrl(endpoint);
                const response = await fetchWithRetry(endpointUrl, {}, {
                    retries: 3,
                    timeoutMs: REQUEST_TIMEOUT_MS,
                });
                if (!response.ok) {
                    const reason = await readErrorMessageFromResponse(response, endpointUrl);
                    throw new Error(`データ取得に失敗しました: ${reason}`);
                }

                const payload = await parseJsonResponse(response, endpointUrl);
                setResults(payload.data || []);
                setTotalResults(payload.total || 0);
                setCurrentPage(payload.page || page);
                setTotalPages(payload.totalPages || 0);
            } catch (error) {
                const data = {
                    phase: 'error',
                    message: `データ読み込みエラー: ${normalizeNetworkErrorMessage(error)}`,
                    progress: progress.progress || 0,
                };
                setProgress(data);
                appendLog(data);
            }
        },
        [appendLog, progress.progress, searchQuery]
    );

    const ensureApiReachable = useCallback(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        const healthCandidates = ['/api/health', '/api/prefectures'];
        let lastError = '';

        try {
            for (const path of healthCandidates) {
                const url = buildApiUrl(path);
                try {
                    const response = await fetchWithRetry(
                        url,
                        { signal: controller.signal },
                        { retries: 2, timeoutMs: 20000 }
                    );
                    if (!response.ok) {
                        lastError = `${url}: HTTP ${response.status}`;
                        continue;
                    }

                    const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
                    if (!contentType.includes('application/json')) {
                        // Static hosting may return index.html for unknown paths.
                        lastError = `${url}: non-json response`;
                        continue;
                    }

                    const json = await response.json().catch(() => ({}));
                    if (path.endsWith('/prefectures')) {
                        if (Array.isArray(json.prefectures)) return;
                        lastError = `${url}: invalid payload`;
                        continue;
                    }

                    if (json && (json.ok === true || typeof json.timestamp === 'string')) {
                        return;
                    }
                    // health route may not include {ok:true}; treat any valid json as alive.
                    return;
                } catch (error) {
                    lastError = `${url}: ${normalizeNetworkErrorMessage(error)}`;
                }
            }

            if (isLocalApiTarget()) {
                throw new Error(
                    `APIに接続できません。ローカルAPIを起動してから再実行してください。接続確認: ${lastError}`
                );
            }
            throw new Error(
                `デプロイ先APIに接続できません。APIの稼働状態か VITE_API_BASE_URL を確認してください。接続確認: ${lastError}`
            );
        } finally {
            clearTimeout(timer);
        }
    }, []);

    const pollJobUntilDone = useCallback(
        async (jobId, baselineTotal = -1, options = {}) => {
            let afterLogSeq = 0;
            const startedAt = Date.now();
            let transientFailureCount = 0;
            let notFoundCount = 0;
            const loadResult = options?.loadResult !== false;
            const setActiveJob = options?.setActiveJob !== false;

            while (Date.now() - startedAt < JOB_POLL_TIMEOUT_MS) {
                const endpoint = `/api/jobs/${encodeURIComponent(jobId)}?after=${afterLogSeq}&maxLogs=${JOB_STATUS_MAX_LOGS}`;
                const statusUrl = buildApiUrl(endpoint);
                let payload = null;
                try {
                    const response = await fetchWithRetry(statusUrl, {}, {
                        retries: 2,
                        timeoutMs: 25000,
                    });
                    if (!response.ok) {
                        const error = new Error(
                            `Job status fetch failed: HTTP ${response.status}`
                        );
                        error.status = response.status;
                        throw error;
                    }
                    payload = await parseJsonResponse(response, statusUrl);
                    transientFailureCount = 0;
                    notFoundCount = 0;
                } catch (pollError) {
                    const status = Number.parseInt(String(pollError?.status || '0'), 10) || 0;
                    if (status === 404) {
                        notFoundCount += 1;
                        if (notFoundCount === 1 || notFoundCount % 3 === 0) {
                            appendLog({
                                phase: 'parse',
                                message: `Job status not found. Retrying (${notFoundCount}/${JOB_NOT_FOUND_RETRY_LIMIT})`,
                                progress: 0,
                            });
                        }

                        let running = false;
                        try {
                            const healthUrl = buildApiUrl('/api/health');
                            const healthResponse = await fetch(healthUrl);
                            if (healthResponse.ok) {
                                const healthPayload = await parseJsonResponse(
                                    healthResponse,
                                    healthUrl
                                ).catch(() => null);
                                running = Boolean(healthPayload?.scraping?.running);
                            }
                        } catch {
                            // ignore health probe failure
                        }

                        try {
                            const countEndpoint = '/api/data?page=1&limit=1';
                            const countUrl = buildApiUrl(countEndpoint);
                            const countResponse = await fetch(countUrl);
                            if (countResponse.ok) {
                                const countPayload = await parseJsonResponse(
                                    countResponse,
                                    countUrl
                                ).catch(() => null);
                                const currentTotal =
                                    Number.parseInt(String(countPayload?.total || '0'), 10) || 0;
                                if (
                                    currentTotal > 0 &&
                                    (baselineTotal < 0 || currentTotal !== baselineTotal)
                                ) {
                                    setSearchQuery('');
                                    await fetchData(1, '', '');
                                    return {
                                        status: 'completed',
                                        total: currentTotal,
                                        sourceStats: [],
                                    };
                                }
                            }
                        } catch {
                            // ignore data probe failure
                        }

                        if (notFoundCount >= JOB_NOT_FOUND_RETRY_LIMIT) {
                            if (!running) {
                                throw new Error(
                                    'Job status is missing. It may have been lost after a server restart. Please run again.'
                                );
                            }
                            throw new Error(
                                'Job status check is unstable. Please wait and try again.'
                            );
                        }

                        await wait(JOB_POLL_INTERVAL_MS);
                        continue;
                    }
                    if (status >= 400 && status < 500 && status !== 429) {
                        throw pollError;
                    }

                    transientFailureCount += 1;
                    if (transientFailureCount % 3 === 1) {
                        appendLog({
                            phase: 'parse',
                            message: `Retrying job status check: ${normalizeNetworkErrorMessage(
                                pollError
                            )}`,
                            progress: 0,
                        });
                    }
                    await wait(JOB_POLL_INTERVAL_MS);
                    continue;
                }

                if (typeof payload.lastLogSeq === 'number') {
                    afterLogSeq = payload.lastLogSeq;
                }

                const chunk = Array.isArray(payload.logs) ? payload.logs : [];
                if (chunk.length) {
                    chunk.forEach((entry) => {
                        appendLog({
                            phase: entry.phase || 'scrape',
                            message: String(entry.message || ''),
                            progress:
                                typeof entry.progress === 'number'
                                    ? entry.progress
                                    : 0,
                        });
                    });

                    const last = chunk[chunk.length - 1];
                    setProgress({
                        phase: last.phase || payload.progress?.phase || '',
                        message: String(last.message || payload.progress?.message || ''),
                        progress:
                            typeof last.progress === 'number'
                                ? last.progress
                                : typeof payload.progress?.progress === 'number'
                                  ? payload.progress.progress
                                  : 0,
                    });
                } else if (payload.progress) {
                    setProgress({
                        phase: payload.progress.phase || '',
                        message: payload.progress.message || '',
                        progress:
                            typeof payload.progress.progress === 'number'
                                ? payload.progress.progress
                                : 0,
                    });
                }

                if (payload.status === 'completed') {
                    if (setActiveJob) {
                        activeJobIdRef.current = jobId;
                    }
                    if (loadResult) {
                        setSearchQuery('');
                        await fetchData(1, '', jobId);
                    }
                    return payload;
                }

                if (payload.status === 'failed') {
                    throw new Error(payload.error || 'スクレイピングジョブが失敗しました。');
                }

                await wait(JOB_POLL_INTERVAL_MS);
            }

            throw new Error('ジョブ追跡がタイムアウトしました。時間を置いて再実行してください。');
        },
        [appendLog, fetchData]
    );

    const readServerTotal = useCallback(async () => {
        const endpoint = '/api/data?page=1&limit=1';
        const url = buildApiUrl(endpoint);
        const response = await fetchWithRetry(url, {}, { retries: 2, timeoutMs: 20000 });
        if (!response.ok) return -1;
        const payload = await parseJsonResponse(response, url).catch(() => null);
        return Number.parseInt(String(payload?.total || '0'), 10) || 0;
    }, []);

    const recoverLegacyScrapeAfterDisconnect = useCallback(
        async (baselineTotal = -1) => {
            let sawRunning = false;
            let idlePolls = 0;
            let lastError = '';
            const startedAt = Date.now();

            appendLog({
                phase: 'parse',
                message: '旧API通信で切断が発生したため、接続復旧を待って結果を確認しています...',
                progress: 0,
            });

            while (Date.now() - startedAt < LEGACY_RECOVERY_TIMEOUT_MS) {
                try {
                    const healthUrl = buildApiUrl('/api/health');
                    const healthResponse = await fetch(healthUrl);
                    if (!healthResponse.ok) {
                        lastError = `health HTTP ${healthResponse.status}`;
                        await wait(LEGACY_RECOVERY_POLL_INTERVAL_MS);
                        continue;
                    }

                    const healthPayload = await parseJsonResponse(healthResponse, healthUrl).catch(
                        () => null
                    );
                    const running = Boolean(healthPayload?.scraping?.running);

                    if (running) {
                        sawRunning = true;
                        idlePolls = 0;
                        setProgress({
                            phase: 'scrape',
                            message: '旧APIが処理中です。復旧を待機しています...',
                            progress: 0,
                        });
                        await wait(LEGACY_RECOVERY_POLL_INTERVAL_MS);
                        continue;
                    }

                    const total = await readServerTotal();
                    if (total >= 0 && total !== baselineTotal && total > 0) {
                        setSearchQuery('');
                        await fetchData(1, '', '');
                        const complete = {
                            phase: 'complete',
                            message: `データ取得完了: ${total.toLocaleString()}件`,
                            progress: 100,
                        };
                        setProgress(complete);
                        appendLog(complete);
                        return true;
                    }

                    idlePolls += 1;
                    if ((sawRunning && idlePolls >= 6) || (!sawRunning && idlePolls >= 8)) {
                        break;
                    }
                } catch (error) {
                    lastError = normalizeNetworkErrorMessage(error);
                }

                await wait(LEGACY_RECOVERY_POLL_INTERVAL_MS);
            }

            appendLog({
                phase: 'error',
                message: `旧API復旧待機に失敗しました: ${lastError || '接続確認ができませんでした'}`,
                progress: 0,
            });
            return false;
        },
        [appendLog, fetchData, readServerTotal]
    );

    const runLegacyScrapeWithRecovery = useCallback(
        async (
            legacyEndpoint,
            prefCodes,
            serviceIds,
            switchMessage,
            requestOptions = {},
            jobPollOptions = {}
        ) => {
            appendLog({
                phase: 'parse',
                message: switchMessage || 'Falling back to legacy API mode...',
                progress: 0,
            });

            const baselineTotal = await readServerTotal().catch(() => -1);
            let legacyResponse;
            try {
                legacyResponse = await fetch(buildApiUrl(legacyEndpoint), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prefectureCodes: prefCodes,
                        serviceTypeIds: serviceIds,
                        appendToCurrentData: Boolean(requestOptions?.appendToCurrentData),
                        resetCurrentData: Boolean(requestOptions?.resetCurrentData),
                    }),
                });
            } catch (legacyRequestError) {
                if (isLikelyNetworkDisconnect(legacyRequestError)) {
                    const recovered = await recoverLegacyScrapeAfterDisconnect(baselineTotal);
                    if (recovered) return true;
                }
                throw legacyRequestError;
            }

            let legacyPayload = {};
            try {
                legacyPayload = await parseJsonResponse(
                    legacyResponse,
                    buildApiUrl(legacyEndpoint)
                );
            } catch {
                legacyPayload = {};
            }

            if (!legacyResponse.ok) {
                if (
                    legacyResponse.status >= 500 ||
                    legacyResponse.status === 408 ||
                    legacyResponse.status === 429
                ) {
                    const recovered = await recoverLegacyScrapeAfterDisconnect(baselineTotal);
                    if (recovered) return true;
                }
                throw new Error(legacyPayload.error || `HTTP ${legacyResponse.status}`);
            }

            const legacyJobId = String(legacyPayload?.jobId || '').trim();
            if (legacyResponse.status === 202 && legacyJobId) {
                appendLog({
                    phase: 'parse',
                    message: 'Legacy endpoint returned async job. Continue polling...',
                    progress: 0,
                });

                const legacyJobResult = await pollJobUntilDone(
                    legacyJobId,
                    baselineTotal,
                    jobPollOptions
                );
                if (Array.isArray(legacyJobResult?.sourceStats)) {
                    legacyJobResult.sourceStats.forEach((stat) => {
                        appendLog({
                            phase: stat.status === 'ok' ? 'parse' : 'error',
                            message: `${stat.source}: ${stat.count} items`,
                            progress: -1,
                        });
                    });
                }

                const total = Number.parseInt(String(legacyJobResult?.total || '0'), 10) || 0;
                const complete = {
                    phase: 'complete',
                    message: `Completed: ${total.toLocaleString()} items`,
                    progress: 100,
                };
                setProgress(complete);
                appendLog(complete);
                return true;
            }

            if (Array.isArray(legacyPayload.sourceStats)) {
                legacyPayload.sourceStats.forEach((stat) => {
                    appendLog({
                        phase: stat.status === 'ok' ? 'parse' : 'error',
                        message: `${stat.source}: ${stat.count} items`,
                        progress: -1,
                    });
                });
            }

            setSearchQuery('');
            await fetchData(1, '', '');

            let legacyTotal =
                Number.parseInt(String(legacyPayload?.total || legacyPayload?.count || '0'), 10) ||
                0;
            if (legacyTotal <= 0) {
                legacyTotal = await readServerTotal().catch(() => 0);
            }

            const legacyComplete = {
                phase: 'complete',
                message: `Completed: ${legacyTotal.toLocaleString()} items`,
                progress: 100,
            };
            setProgress(legacyComplete);
            appendLog(legacyComplete);
            return true;
        },
        [
            appendLog,
            fetchData,
            pollJobUntilDone,
            readServerTotal,
            recoverLegacyScrapeAfterDisconnect,
        ]
    );

    const startScraping = useCallback(
        async (prefCodes, serviceIds, method = 'multi') => {
            setIsLoading(true);
            setLogs([]);
            setResults([]);
            setCurrentPage(1);
            setTotalPages(0);
            setTotalResults(0);
            activeJobIdRef.current = '';
            setProgress({
                message: 'Starting scrape job...',
                progress: 0,
                phase: 'start',
            });

            const endpointByMethod = {
                multi: '/api/scrape/multi',
                opendata: '/api/scrape/opendata',
                web: '/api/scrape/web',
            };
            const legacyEndpoint = endpointByMethod[method] || endpointByMethod.multi;

            const submitAndTrackJob = async (
                targetServiceIds,
                {
                    appendToCurrentData = false,
                    resetCurrentData = false,
                    suppressCompleteLog = false,
                    pollOptions = {},
                } = {}
            ) => {
                const endpoint = '/api/jobs';
                const baselineTotalForJob = await readServerTotal().catch(() => -1);
                const response = await fetchWithRetry(buildApiUrl(endpoint), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        method,
                        prefectureCodes: prefCodes,
                        serviceTypeIds: targetServiceIds,
                        appendToCurrentData,
                        resetCurrentData,
                    }),
                }, {
                    retries: 2,
                    timeoutMs: REQUEST_TIMEOUT_MS,
                });

                let payload = {};
                try {
                    payload = await parseJsonResponse(response, buildApiUrl(endpoint));
                } catch {
                    payload = {};
                }

                if (!response.ok) {
                    if (response.status === 404) {
                        await runLegacyScrapeWithRecovery(
                            legacyEndpoint,
                            prefCodes,
                            targetServiceIds,
                            'New API endpoint is unavailable. Switching to legacy mode...',
                        );
                        const total = await readServerTotal().catch(() => 0);
                        return {
                            status: 'completed',
                            total,
                            accumulatedTotal: total,
                            sourceStats: [],
                        };
                    }
                    throw new Error(payload.error || `HTTP ${response.status}`);
                }

                const jobId = String(payload?.jobId || '').trim();
                if (!jobId) {
                    throw new Error('Job ID was not returned by API.');
                }

                const queued = {
                    phase: 'start',
                    message:
                        Number.parseInt(String(payload?.queuePosition || '0'), 10) > 1
                            ? `Job accepted (queue: ${payload.queuePosition})`
                            : 'Job accepted. Tracking progress...',
                    progress: 0,
                };
                setProgress(queued);
                appendLog(queued);

                let jobResult;
                try {
                    jobResult = await pollJobUntilDone(jobId, baselineTotalForJob, pollOptions);
                } catch (jobTrackingError) {
                    const trackingMessage = String(jobTrackingError?.message || '');
                    if (
                        /HTTP 404|job not found|job status|timeout|network|fetch/i.test(
                            trackingMessage
                        )
                    ) {
                        await runLegacyScrapeWithRecovery(
                            legacyEndpoint,
                            prefCodes,
                            targetServiceIds,
                            'Job tracking failed. Retrying with legacy mode...',
                            {
                                appendToCurrentData,
                                resetCurrentData,
                            },
                            pollOptions
                        );
                        const total = await readServerTotal().catch(() => 0);
                        jobResult = {
                            status: 'completed',
                            total,
                            accumulatedTotal: total,
                            sourceStats: [],
                        };
                    } else {
                        throw jobTrackingError;
                    }
                }

                if (Array.isArray(jobResult?.sourceStats)) {
                    jobResult.sourceStats.forEach((stat) => {
                        appendLog({
                            phase: stat.status === 'ok' ? 'parse' : 'error',
                            message: `${stat.source}: ${stat.count} items`,
                            progress: -1,
                        });
                    });
                }

                if (!suppressCompleteLog) {
                    const total = Number.parseInt(String(jobResult?.total || '0'), 10) || 0;
                    const complete = {
                        phase: 'complete',
                        message: `Completed: ${total.toLocaleString()} items`,
                        progress: 100,
                    };
                    setProgress(complete);
                    appendLog(complete);
                }

                return jobResult;
            };

            try {
                if (serviceIds.length > MAX_SERVICE_SELECTION) {
                    throw new Error(
                        `You can run up to ${MAX_SERVICE_SELECTION} service types at once.`
                    );
                }

                try {
                    await ensureApiReachable();
                } catch (healthError) {
                    if (isLocalApiTarget()) throw healthError;
                    appendLog({
                        phase: 'parse',
                        message: `health-check warning: ${normalizeNetworkErrorMessage(healthError)}`,
                        progress: 0,
                    });
                }

                const shouldSplitByService = serviceIds.length > 1;
                if (shouldSplitByService) {
                    const serviceChunks = chunkArray(serviceIds, SERVICE_BATCH_SIZE);
                    appendLog({
                        phase: 'start',
                        message: `Load-spread mode enabled: ${serviceChunks.length} jobs`,
                        progress: 0,
                    });

                    try {
                        await fetch(buildApiUrl('/api/data'), { method: 'DELETE' });
                    } catch {
                        // ignore cleanup failure and continue
                    }

                    activeJobIdRef.current = '';
                    let accumulatedTotal = 0;

                    for (let i = 0; i < serviceChunks.length; i += 1) {
                        const chunk = serviceChunks[i];
                        appendLog({
                            phase: 'start',
                            message: `Processing chunk ${i + 1}/${serviceChunks.length} (${chunk.join(',')})`,
                            progress: 0,
                        });

                        const jobResult = await submitAndTrackJob(chunk, {
                            appendToCurrentData: true,
                            resetCurrentData: i === 0,
                            suppressCompleteLog: true,
                            pollOptions: {
                                loadResult: false,
                                setActiveJob: false,
                            },
                        });

                        const mergedTotalFromJob =
                            Number.parseInt(String(jobResult?.accumulatedTotal || '0'), 10) || 0;
                        if (mergedTotalFromJob > 0) {
                            accumulatedTotal = mergedTotalFromJob;
                        } else {
                            accumulatedTotal = await readServerTotal().catch(() => accumulatedTotal);
                        }

                        const progressRatio = Math.round(((i + 1) / serviceChunks.length) * 100);
                        setProgress({
                            phase: 'parse',
                            message: `Chunk ${i + 1}/${serviceChunks.length} completed`,
                            progress: progressRatio,
                        });
                    }

                    setSearchQuery('');
                    await fetchData(1, '', '');

                    const finalTotal =
                        (await readServerTotal().catch(() => accumulatedTotal)) || accumulatedTotal;
                    const complete = {
                        phase: 'complete',
                        message: `Completed: ${Number(finalTotal).toLocaleString()} items`,
                        progress: 100,
                    };
                    setProgress(complete);
                    appendLog(complete);
                    return;
                }

                await submitAndTrackJob(serviceIds);
            } catch (error) {
                const failed = {
                    phase: 'error',
                    message: `Error: ${normalizeNetworkErrorMessage(error)}`,
                    progress: 0,
                };
                setProgress(failed);
                appendLog(failed);
            } finally {
                setIsLoading(false);
            }
        },
        [
            appendLog,
            ensureApiReachable,
            fetchData,
            pollJobUntilDone,
            readServerTotal,
            runLegacyScrapeWithRecovery,
        ]
    );

    const exportData = useCallback(
        async (format) => {
            if (totalResults === 0) {
                alert('エクスポートするデータがありません');
                return;
            }

            const activeJobId = activeJobIdRef.current;
            const encodedJobId = activeJobId ? encodeURIComponent(activeJobId) : '';

            if (format === 'excel') {
                try {
                    const limit = 5000;
                    const allRows = [];
                    let page = 1;
                    let expectedTotal = 0;

                    while (page <= 2000) {
                        const primaryEndpoint = encodedJobId
                            ? `/api/data?page=${page}&limit=${limit}&jobId=${encodedJobId}`
                            : `/api/data?page=${page}&limit=${limit}`;
                        let endpoint = primaryEndpoint;
                        let response = await fetchWithRetry(buildApiUrl(endpoint), {}, {
                            retries: 2,
                            timeoutMs: REQUEST_TIMEOUT_MS,
                        });

                        if (!response.ok && response.status === 404 && encodedJobId) {
                            endpoint = `/api/data?page=${page}&limit=${limit}`;
                            response = await fetchWithRetry(buildApiUrl(endpoint), {}, {
                                retries: 2,
                                timeoutMs: REQUEST_TIMEOUT_MS,
                            });
                        }

                        if (!response.ok) {
                            const reason = await readErrorMessageFromResponse(
                                response,
                                buildApiUrl(endpoint)
                            );
                            throw new Error(reason);
                        }

                        const payload = await parseJsonResponse(
                            response,
                            buildApiUrl(endpoint)
                        );
                        const chunk = Array.isArray(payload?.data) ? payload.data : [];
                        if (!chunk.length) break;

                        allRows.push(...chunk);
                        expectedTotal =
                            Number.parseInt(String(payload?.total || '0'), 10) || 0;
                        if (expectedTotal > 0 && allRows.length >= expectedTotal) {
                            break;
                        }
                        page += 1;
                    }

                    const source = allRows.length ? allRows : results;
                    if (!source.length) {
                        throw new Error('No exportable rows');
                    }

                    const blob = buildExcelBlob(source);
                    pushDownloadBlob(blob, 'kaigo_data.xlsx');
                    return;
                } catch (error) {
                    appendLog({
                        phase: 'error',
                        message: `excel-local-export-failed: ${normalizeNetworkErrorMessage(
                            error
                        )}`,
                        progress: -1,
                    });

                    if (results.length > 0) {
                        const blob = buildExcelBlob(results);
                        pushDownloadBlob(blob, 'kaigo_data.xlsx');
                        return;
                    }
                }
            }

            const baseExportPath = format === 'csv' ? '/api/export/csv' : '/api/export/excel';
            const exportPaths = encodedJobId
                ? [`${baseExportPath}?jobId=${encodedJobId}`, baseExportPath]
                : [baseExportPath];
            const fallbackName = format === 'csv' ? 'kaigo_data.csv' : 'kaigo_data.xlsx';
            let lastErrorMessage = '';

            for (const exportPath of exportPaths) {
                try {
                    const response = await fetchWithRetry(buildApiUrl(exportPath), {}, {
                        retries: 2,
                        timeoutMs: REQUEST_TIMEOUT_MS,
                    });
                    if (!response.ok) {
                        lastErrorMessage = await readErrorMessageFromResponse(
                            response,
                            buildApiUrl(exportPath)
                        );
                        continue;
                    }

                    const blob = await response.blob();
                    const fileName = readFileNameFromDisposition(
                        response.headers.get('Content-Disposition'),
                        fallbackName
                    );
                    pushDownloadBlob(blob, fileName);
                    return;
                } catch (error) {
                    lastErrorMessage = normalizeNetworkErrorMessage(error);
                }
            }

            if (format === 'excel' && results.length > 0) {
                const blob = buildExcelBlob(results);
                pushDownloadBlob(blob, 'kaigo_data.xlsx');
                return;
            }

            alert(
                `エクスポートに失敗しました: ${
                    lastErrorMessage || '原因を特定できませんでした'
                }`
            );
        },
        [appendLog, results, totalResults]
    );

    const clearData = useCallback(async () => {
        try {
            const activeJobId = activeJobIdRef.current;
            const path = activeJobId
                ? `/api/data?jobId=${encodeURIComponent(activeJobId)}`
                : '/api/data';
            await fetch(buildApiUrl(path), { method: 'DELETE' });
        } catch {
            // ignore clear API failure and continue local reset
        }

        activeJobIdRef.current = '';
        setResults([]);
        setTotalResults(0);
        setCurrentPage(1);
        setTotalPages(0);
        setSearchQuery('');
        setLogs([]);
        setProgress({ message: '', progress: 0, phase: '' });
    }, []);

    return {
        prefectures,
        regions,
        serviceTypes,
        results,
        totalResults,
        isLoading,
        progress,
        logs,
        currentPage,
        totalPages,
        searchQuery,
        setSearchQuery,
        startScraping,
        fetchData,
        exportData,
        clearData,
    };
}
