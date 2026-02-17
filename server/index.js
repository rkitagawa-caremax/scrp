import express from 'express';
import cors from 'cors';
import { PREFECTURES, REGIONS, SERVICE_TYPES } from './utils/prefectures.js';
import { fetchOpenData } from './scrapers/opendata.js';
import { scrapeWebData } from './scrapers/web-scraper.js';
import { scrapeFromMultipleSources } from './scrapers/multi-source.js';
import { toCSV, toExcel } from './utils/export.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// 取得済みデータをメモリに保持
let currentData = [];
// SSEクライアント管理
const sseClients = new Set();

// ─── API エンドポイント ─────────────────────

/**
 * 都道府県一覧
 */
app.get('/api/prefectures', (req, res) => {
    res.json({
        prefectures: PREFECTURES,
        regions: REGIONS,
    });
});

/**
 * サービス種別一覧
 */
app.get('/api/service-types', (req, res) => {
    res.json({ serviceTypes: SERVICE_TYPES });
});

/**
 * ヘルスチェック
 */
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        timestamp: new Date().toISOString(),
    });
});

/**
 * SSE - リアルタイム進捗配信
 */
app.get('/api/progress', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    sseClients.add(res);

    req.on('close', () => {
        sseClients.delete(res);
    });
});

/**
 * 進捗をSSEで全クライアントに送信
 */
function broadcastProgress(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(message);
        } catch (err) {
            sseClients.delete(client);
        }
    }
}

/**
 * リクエストの入力チェック
 */
function validateScrapeRequest(req, res) {
    const { prefectureCodes, serviceTypeIds } = req.body;

    if (!prefectureCodes?.length || !serviceTypeIds?.length) {
        res.status(400).json({
            error: '都道府県とサービス種別を選択してください',
        });
        return null;
    }

    return { prefectureCodes, serviceTypeIds };
}

/**
 * 複数サイト統合取得（推奨）
 */
app.post('/api/scrape/multi', async (req, res) => {
    const payload = validateScrapeRequest(req, res);
    if (!payload) return;

    const { prefectureCodes, serviceTypeIds } = payload;

    try {
        broadcastProgress({
            phase: 'start',
            message: '複数ソース取得を開始します...',
            progress: 0,
        });

        const { records, sourceStats } = await scrapeFromMultipleSources(
            prefectureCodes,
            serviceTypeIds,
            broadcastProgress
        );

        currentData = records;

        broadcastProgress({
            phase: 'complete',
            message: `複数ソース取得完了: ${records.length}件`,
            progress: 100,
        });

        res.json({
            success: true,
            count: records.length,
            data: records.slice(0, 100),
            total: records.length,
            sourceStats,
        });
    } catch (err) {
        broadcastProgress({
            phase: 'error',
            message: `エラー: ${err.message}`,
            progress: 0,
        });
        res.status(500).json({ error: err.message });
    }
});

/**
 * 公式オープンデータのみ
 */
app.post('/api/scrape/opendata', async (req, res) => {
    const payload = validateScrapeRequest(req, res);
    if (!payload) return;

    const { prefectureCodes, serviceTypeIds } = payload;

    try {
        broadcastProgress({
            phase: 'start',
            message: '公式オープンデータ取得を開始します...',
            progress: 0,
        });

        const results = await fetchOpenData(
            prefectureCodes,
            serviceTypeIds,
            broadcastProgress
        );
        if (results.length === 0) {
            throw new Error('公式オープンデータから取得できませんでした。ネットワーク状態を確認してください。');
        }

        currentData = results;

        broadcastProgress({
            phase: 'complete',
            message: `取得完了: ${results.length}件`,
            progress: 100,
        });

        res.json({
            success: true,
            count: results.length,
            data: results.slice(0, 100),
            total: results.length,
            sourceStats: [{ source: 'official-opendata', count: results.length, status: 'ok' }],
        });
    } catch (err) {
        broadcastProgress({
            phase: 'error',
            message: `エラー: ${err.message}`,
            progress: 0,
        });
        res.status(500).json({ error: err.message });
    }
});

/**
 * Webスクレイピングでデータ取得
 */
app.post('/api/scrape/web', async (req, res) => {
    const payload = validateScrapeRequest(req, res);
    if (!payload) return;

    const { prefectureCodes, serviceTypeIds } = payload;

    try {
        broadcastProgress({
            phase: 'start',
            message: 'Webスクレイピングを開始します...',
            progress: 0,
        });

        const results = await scrapeWebData(
            prefectureCodes,
            serviceTypeIds,
            broadcastProgress
        );
        if (results.length === 0) {
            throw new Error('Webスクレイピングで取得できませんでした。取得先サイト仕様変更の可能性があります。');
        }

        currentData = results;

        broadcastProgress({
            phase: 'complete',
            message: `取得完了: ${results.length}件`,
            progress: 100,
        });

        res.json({
            success: true,
            count: results.length,
            data: results.slice(0, 100),
            total: results.length,
            sourceStats: [{ source: 'web-scraping', count: results.length, status: 'ok' }],
        });
    } catch (err) {
        broadcastProgress({
            phase: 'error',
            message: `エラー: ${err.message}`,
            progress: 0,
        });
        res.status(500).json({ error: err.message });
    }
});

/**
 * 全データ取得（ページネーション対応）
 */
app.get('/api/data', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';

    let filtered = currentData;

    if (search) {
        const s = search.toLowerCase();
        filtered = currentData.filter(
            (item) =>
                (item.name || '').toLowerCase().includes(s) ||
                (item.address || '').toLowerCase().includes(s) ||
                (item.corporateName || '').toLowerCase().includes(s) ||
                (item.prefecture || '').toLowerCase().includes(s)
        );
    }

    const start = (page - 1) * limit;
    const paged = filtered.slice(start, start + limit);

    res.json({
        data: paged,
        total: filtered.length,
        page,
        limit,
        totalPages: Math.ceil(filtered.length / limit),
    });
});

/**
 * CSVエクスポート
 */
app.get('/api/export/csv', (req, res) => {
    if (currentData.length === 0) {
        return res.status(404).json({ error: 'エクスポートするデータがありません' });
    }

    const csv = toCSV(currentData);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
        'Content-Disposition',
        'attachment; filename="kaigo_data.csv"'
    );
    res.send(csv);
});

/**
 * Excelエクスポート
 */
app.get('/api/export/excel', (req, res) => {
    if (currentData.length === 0) {
        return res.status(404).json({ error: 'エクスポートするデータがありません' });
    }

    const buffer = toExcel(currentData);
    res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
        'Content-Disposition',
        'attachment; filename="kaigo_data.xlsx"'
    );
    res.send(Buffer.from(buffer));
});

/**
 * データクリア
 */
app.delete('/api/data', (req, res) => {
    currentData = [];
    res.json({ success: true });
});

// ─── サーバー起動 ─────────────────────────

app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🏥 介護施設スクレイパーサーバー起動`);
    console.log(`   http://127.0.0.1:${PORT}`);
    console.log(`   API: http://127.0.0.1:${PORT}/api/prefectures\n`);
});
