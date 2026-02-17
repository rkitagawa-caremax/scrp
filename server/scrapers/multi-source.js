import { fetchOpenData } from './opendata.js';
import { fetchDataGoData } from './data-go.js';
import { scrapeWebData } from './web-scraper.js';
import { dedupeRecords } from './record-normalizer.js';

function wrapSourceProgress(sourceLabel, onProgress) {
    return (progressData) => {
        if (!onProgress) return;
        const message = progressData?.message
            ? `${sourceLabel} ${progressData.message}`
            : sourceLabel;
        onProgress({
            phase: progressData?.phase || 'scrape',
            progress:
                typeof progressData?.progress === 'number'
                    ? progressData.progress
                    : -1,
            message,
        });
    };
}

function buildEmptyStats(source, errorMessage = '') {
    return {
        source,
        count: 0,
        status: errorMessage ? 'error' : 'empty',
        error: errorMessage,
    };
}

function shouldRunWebFallback(existingRecords, prefectureCodes, serviceTypeIds) {
    const existingCount = existingRecords.length;
    const requestedMatrixSize = prefectureCodes.length * serviceTypeIds.length;
    const expectedMinimum = Math.max(250, requestedMatrixSize * 12);
    if (existingCount < expectedMinimum) return true;

    const withUserCount = existingRecords.filter(
        (record) => String(record?.userCount || '').trim() !== ''
    ).length;
    const userCountCoverage = existingCount > 0 ? withUserCount / existingCount : 0;

    // Run web source when open data is large enough but lacks user-count fields.
    return userCountCoverage < 0.2;
}

/**
 * 複数ソースを順次取得して統合する
 */
export async function scrapeFromMultipleSources(
    prefectureCodes,
    serviceTypeIds,
    onProgress
) {
    const sourceStats = [];
    let merged = [];

    const sources = [
        {
            id: 'official-opendata',
            label: '[公式]',
            run: fetchOpenData,
        },
        {
            id: 'data-go',
            label: '[data.go.jp]',
            run: fetchDataGoData,
        },
    ];

    for (const source of sources) {
        onProgress?.({
            phase: 'start',
            message: `${source.label} 取得開始`,
            progress: -1,
        });

        try {
            const records = await source.run(
                prefectureCodes,
                serviceTypeIds,
                wrapSourceProgress(source.label, onProgress)
            );
            const deduped = dedupeRecords(records);
            merged = dedupeRecords([...merged, ...deduped]);
            sourceStats.push({
                source: source.id,
                count: deduped.length,
                status: deduped.length > 0 ? 'ok' : 'empty',
            });

            onProgress?.({
                phase: 'parse',
                message: `${source.label} 完了: ${deduped.length}件`,
                progress: -1,
            });
        } catch (error) {
            sourceStats.push(buildEmptyStats(source.id, error.message));
            onProgress?.({
                phase: 'error',
                message: `${source.label} 失敗: ${error.message}`,
                progress: -1,
            });
        }
    }

    if (shouldRunWebFallback(merged, prefectureCodes, serviceTypeIds)) {
        const webSourceId = 'web-scraping-fallback';
        const webLabel = '[Web補完]';

        onProgress?.({
            phase: 'scrape',
            message: `${webLabel} 件数不足のため追加取得を開始`,
            progress: -1,
        });

        try {
            const records = await scrapeWebData(
                prefectureCodes,
                serviceTypeIds,
                wrapSourceProgress(webLabel, onProgress)
            );
            const deduped = dedupeRecords(records);
            merged = dedupeRecords([...merged, ...deduped]);
            sourceStats.push({
                source: webSourceId,
                count: deduped.length,
                status: 'ok',
            });
        } catch (error) {
            sourceStats.push(buildEmptyStats(webSourceId, error.message));
            onProgress?.({
                phase: 'error',
                message: `${webLabel} 失敗: ${error.message}`,
                progress: -1,
            });
        }
    }

    const finalRecords = dedupeRecords(merged);
    if (finalRecords.length === 0) {
        throw new Error(
            'すべてのソースで0件でした。ネットワーク制限、プロキシ、または取得先サイトのアクセス可否を確認してください。'
        );
    }

    return {
        records: finalRecords,
        sourceStats,
    };
}
