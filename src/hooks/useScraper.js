import { useCallback, useRef, useState } from 'react';
import { PREFECTURES, REGIONS, SERVICE_TYPES } from '../data/masterData.js';

const PAGE_SIZE = 50;
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

function buildApiUrl(path) {
    return `${API_BASE}${path}`;
}

function normalizeNetworkErrorMessage(error) {
    const text = String(error?.message || '');
    if (/failed to fetch|networkerror|network request failed/i.test(text)) {
        return (
            'APIへ接続できません。`npm run server` が起動しているか確認してください。' +
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
                // ignore invalid message
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

            try {
                const response = await fetch(buildApiUrl(`/api/data?${params.toString()}`));
                if (!response.ok) {
                    throw new Error(`データ取得失敗: HTTP ${response.status}`);
                }

                const payload = await response.json();
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
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(buildApiUrl('/api/health'), {
                signal: controller.signal,
            });
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(
                        'APIサーバーが古いバージョンです。3001番のNodeプロセスを停止して、`npm run server` を再起動してください。'
                    );
                }
                throw new Error(`ヘルスチェック失敗: HTTP ${response.status}`);
            }
        } catch (error) {
            throw new Error(normalizeNetworkErrorMessage(error));
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
                await ensureApiReachable();
                openProgressStream();

                const response = await fetch(buildApiUrl(endpoint), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prefectureCodes: prefCodes,
                        serviceTypeIds: serviceIds,
                    }),
                });

                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
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
                alert(
                    `エクスポートに失敗しました: ${normalizeNetworkErrorMessage(error)}`
                );
            }
        },
        [totalResults]
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
