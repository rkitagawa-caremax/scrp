import { useCallback, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { PREFECTURES, REGIONS, SERVICE_TYPES } from '../data/masterData.js';

const PAGE_SIZE = 50;
const RAW_API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').trim();
const DEFAULT_REMOTE_API_BASE = 'https://scrp-5na6.onrender.com';
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
                'APIに接続できません。`npm run server` が起動しているか確認してください。' +
                ` 接続先: ${buildApiUrl('/api/health')}`
            );
        }
        return (
            'APIに接続できません。デプロイ先のAPI URL設定とバックエンド稼働状態を確認してください。' +
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

    const progressEventSourceRef = useRef(null);

    const appendLog = useCallback((data) => {
        setLogs((prev) => {
            const newLogs = [
                ...prev,
                { time: new Date().toLocaleTimeString(), ...data },
            ];
            return newLogs.slice(-120);
        });
    }, []);

    const closeProgressStream = useCallback(() => {
        if (!progressEventSourceRef.current) return;
        progressEventSourceRef.current.close();
        progressEventSourceRef.current = null;
    }, []);

    const openProgressStream = useCallback(() => {
        closeProgressStream();
        const eventSource = new EventSource(buildApiUrl('/api/progress'));
        progressEventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                setProgress(data);
                appendLog(data);
            } catch {
                // ignore malformed SSE message
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
            if (progressEventSourceRef.current === eventSource) {
                progressEventSourceRef.current = null;
            }
        };
    }, [appendLog, closeProgressStream]);

    const fetchData = useCallback(
        async (page, overrideSearch) => {
            const search = overrideSearch ?? searchQuery;
            const params = new URLSearchParams({
                page: String(page),
                limit: String(PAGE_SIZE),
            });
            if (search) params.set('search', search);

            const endpoint = `/api/data?${params.toString()}`;
            try {
                const response = await fetch(buildApiUrl(endpoint));
                if (!response.ok) {
                    throw new Error(`データ取得失敗: HTTP ${response.status}`);
                }

                const payload = await parseJsonResponse(response, buildApiUrl(endpoint));
                setResults(payload.data || []);
                setTotalResults(payload.total || 0);
                setCurrentPage(payload.page || page);
                setTotalPages(payload.totalPages || 0);
            } catch (error) {
                const data = {
                    phase: 'error',
                    message: `データ読込エラー: ${normalizeNetworkErrorMessage(error)}`,
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
                    const response = await fetch(url, { signal: controller.signal });
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
                    `APIに接続できません。ローカルAPIを起動してください。最終確認: ${lastError}`
                );
            }
            throw new Error(
                `デプロイ先APIに接続できません。APIデプロイまたは VITE_API_BASE_URL を確認してください。最終確認: ${lastError}`
            );
        } finally {
            clearTimeout(timer);
        }
    }, []);

    const startScraping = useCallback(
        async (prefCodes, serviceIds, method = 'multi') => {
            setIsLoading(true);
            setLogs([]);
            setResults([]);
            setCurrentPage(1);
            setTotalPages(0);
            setTotalResults(0);
            setProgress({
                message: '取得処理を開始しています...',
                progress: 0,
                phase: 'start',
            });

            const endpointByMethod = {
                multi: '/api/scrape/multi',
                opendata: '/api/scrape/opendata',
                web: '/api/scrape/web',
            };
            const endpoint = endpointByMethod[method] || endpointByMethod.multi;

            try {
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
                openProgressStream();

                const response = await fetch(buildApiUrl(endpoint), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prefectureCodes: prefCodes,
                        serviceTypeIds: serviceIds,
                    }),
                });

                let payload = {};
                try {
                    payload = await parseJsonResponse(response, buildApiUrl(endpoint));
                } catch {
                    payload = {};
                }

                if (!response.ok) {
                    if (response.status === 404) {
                        throw new Error(
                            `APIエンドポイントが見つかりません: ${buildApiUrl(
                                endpoint
                            )}。バックエンドが旧版か、デプロイ先が誤っています。`
                        );
                    }
                    throw new Error(payload.error || `HTTP ${response.status}`);
                }

                if (Array.isArray(payload.sourceStats)) {
                    payload.sourceStats.forEach((stat) => {
                        appendLog({
                            phase: stat.status === 'ok' ? 'parse' : 'error',
                            message: `${stat.source}: ${stat.count}件`,
                            progress: -1,
                        });
                    });
                }

                setSearchQuery('');
                await fetchData(1, '');

                const complete = {
                    phase: 'complete',
                    message: `取得完了: ${(payload.total || payload.count || 0).toLocaleString()}件`,
                    progress: 100,
                };
                setProgress(complete);
                appendLog(complete);
            } catch (error) {
                const failed = {
                    phase: 'error',
                    message: `エラー: ${normalizeNetworkErrorMessage(error)}`,
                    progress: 0,
                };
                setProgress(failed);
                appendLog(failed);
            } finally {
                closeProgressStream();
                setIsLoading(false);
            }
        },
        [
            appendLog,
            closeProgressStream,
            ensureApiReachable,
            fetchData,
            openProgressStream,
        ]
    );

    const exportData = useCallback(
        async (format) => {
            if (totalResults === 0) {
                alert('エクスポートするデータがありません');
                return;
            }

            if (format === 'excel') {
                try {
                    const limit = 5000;
                    const allRows = [];
                    let page = 1;
                    let expectedTotal = 0;

                    while (page <= 2000) {
                        const endpoint = `/api/data?page=${page}&limit=${limit}`;
                        const response = await fetch(buildApiUrl(endpoint));
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
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
                }
            }

            const exportPath = format === 'csv' ? '/api/export/csv' : '/api/export/excel';
            const fallbackName = format === 'csv' ? 'kaigo_data.csv' : 'kaigo_data.xlsx';

            try {
                const response = await fetch(buildApiUrl(exportPath));
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const blob = await response.blob();
                const fileName = readFileNameFromDisposition(
                    response.headers.get('Content-Disposition'),
                    fallbackName
                );
                pushDownloadBlob(blob, fileName);
            } catch (error) {
                alert(`エクスポート失敗: ${normalizeNetworkErrorMessage(error)}`);
            }
        },
        [appendLog, results, totalResults]
    );

    const clearData = useCallback(async () => {
        try {
            await fetch(buildApiUrl('/api/data'), { method: 'DELETE' });
        } catch {
            // ignore clear API failure and continue local reset
        }

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
