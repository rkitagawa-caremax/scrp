import express from 'express';
import cors from 'cors';
import { PREFECTURES, REGIONS, SERVICE_TYPES } from './utils/prefectures.js';
import { fetchOpenData } from './scrapers/opendata.js';
import { scrapeWebData } from './scrapers/web-scraper.js';
import { scrapeFromMultipleSources } from './scrapers/multi-source.js';
import { toCSV, toExcel } from './utils/export.js';

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json());

let currentData = [];
const sseClients = new Set();
let activeScrapeJob = null;

function normalizeUserCountValue(item) {
    const candidates = [
        item?.userCount,
        item?.totalUserNum,
        item?.TotalUserNum,
        item?.['利用者人数'],
        item?.['利用者数'],
    ];
    const first = candidates.find(
        (value) => value !== undefined && value !== null && String(value).trim() !== ''
    );
    if (first === undefined) return '';
    return String(first).replace(/[^\d]/g, '');
}

function normalizeRecordShape(item) {
    return {
        ...item,
        userCount: normalizeUserCountValue(item),
    };
}

function broadcastProgress(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(message);
        } catch {
            sseClients.delete(client);
        }
    }
}

function validateScrapeRequest(req, res) {
    const { prefectureCodes, serviceTypeIds } = req.body || {};
    if (!Array.isArray(prefectureCodes) || prefectureCodes.length === 0) {
        res.status(400).json({ error: '都道府県を選択してください。' });
        return null;
    }
    if (!Array.isArray(serviceTypeIds) || serviceTypeIds.length === 0) {
        res.status(400).json({ error: 'サービス種別を選択してください。' });
        return null;
    }
    return { prefectureCodes, serviceTypeIds };
}

function tryStartScrapeJob(kind) {
    if (activeScrapeJob?.running) return null;
    const job = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        running: true,
        startedAt: Date.now(),
    };
    activeScrapeJob = job;
    return job;
}

function finishScrapeJob(job) {
    if (!job) return;
    if (activeScrapeJob && activeScrapeJob.id === job.id) {
        activeScrapeJob = null;
    }
}

function busyErrorResponse(res) {
    return res.status(409).json({
        error: '現在別のスクレイピング処理が実行中です。完了後に再実行してください。',
    });
}

app.get('/api/prefectures', (_req, res) => {
    res.json({ prefectures: PREFECTURES, regions: REGIONS });
});

app.get('/api/service-types', (_req, res) => {
    res.json({ serviceTypes: SERVICE_TYPES });
});

app.get('/api/health', (_req, res) => {
    res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        scraping: activeScrapeJob
            ? {
                  running: true,
                  kind: activeScrapeJob.kind,
                  startedAt: new Date(activeScrapeJob.startedAt).toISOString(),
              }
            : { running: false },
    });
});

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

app.post('/api/scrape/multi', async (req, res) => {
    const payload = validateScrapeRequest(req, res);
    if (!payload) return;

    const job = tryStartScrapeJob('multi');
    if (!job) return busyErrorResponse(res);

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

        currentData = records.map(normalizeRecordShape);

        broadcastProgress({
            phase: 'complete',
            message: `取得完了: ${currentData.length.toLocaleString()}件`,
            progress: 100,
        });

        res.json({
            success: true,
            count: currentData.length,
            data: currentData.slice(0, 100),
            total: currentData.length,
            sourceStats,
        });
    } catch (error) {
        broadcastProgress({
            phase: 'error',
            message: `エラー: ${error.message}`,
            progress: 0,
        });
        res.status(500).json({ error: error.message });
    } finally {
        finishScrapeJob(job);
    }
});

app.post('/api/scrape/opendata', async (req, res) => {
    const payload = validateScrapeRequest(req, res);
    if (!payload) return;

    const job = tryStartScrapeJob('opendata');
    if (!job) return busyErrorResponse(res);

    const { prefectureCodes, serviceTypeIds } = payload;

    try {
        broadcastProgress({
            phase: 'start',
            message: '公式オープンデータ取得を開始します...',
            progress: 0,
        });

        const records = await fetchOpenData(
            prefectureCodes,
            serviceTypeIds,
            broadcastProgress
        );
        if (!records.length) {
            throw new Error(
                '公式オープンデータから取得できませんでした。条件を変更して再実行してください。'
            );
        }

        currentData = records.map(normalizeRecordShape);

        broadcastProgress({
            phase: 'complete',
            message: `取得完了: ${currentData.length.toLocaleString()}件`,
            progress: 100,
        });

        res.json({
            success: true,
            count: currentData.length,
            data: currentData.slice(0, 100),
            total: currentData.length,
            sourceStats: [
                {
                    source: 'official-opendata',
                    count: currentData.length,
                    status: 'ok',
                },
            ],
        });
    } catch (error) {
        broadcastProgress({
            phase: 'error',
            message: `エラー: ${error.message}`,
            progress: 0,
        });
        res.status(500).json({ error: error.message });
    } finally {
        finishScrapeJob(job);
    }
});

app.post('/api/scrape/web', async (req, res) => {
    const payload = validateScrapeRequest(req, res);
    if (!payload) return;

    const job = tryStartScrapeJob('web');
    if (!job) return busyErrorResponse(res);

    const { prefectureCodes, serviceTypeIds } = payload;

    try {
        broadcastProgress({
            phase: 'start',
            message: 'Webスクレイピングを開始します...',
            progress: 0,
        });

        const records = await scrapeWebData(
            prefectureCodes,
            serviceTypeIds,
            broadcastProgress
        );
        if (!records.length) {
            throw new Error(
                'Webスクレイピングで取得できませんでした。条件を変更して再実行してください。'
            );
        }

        currentData = records.map(normalizeRecordShape);

        broadcastProgress({
            phase: 'complete',
            message: `取得完了: ${currentData.length.toLocaleString()}件`,
            progress: 100,
        });

        res.json({
            success: true,
            count: currentData.length,
            data: currentData.slice(0, 100),
            total: currentData.length,
            sourceStats: [
                {
                    source: 'web-scraping',
                    count: currentData.length,
                    status: 'ok',
                },
            ],
        });
    } catch (error) {
        broadcastProgress({
            phase: 'error',
            message: `エラー: ${error.message}`,
            progress: 0,
        });
        res.status(500).json({ error: error.message });
    } finally {
        finishScrapeJob(job);
    }
});

app.get('/api/data', (req, res) => {
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 50;
    const search = String(req.query.search || '').trim().toLowerCase();

    let filtered = currentData;
    if (search) {
        filtered = currentData.filter((item) => {
            return (
                String(item.name || '').toLowerCase().includes(search) ||
                String(item.address || '').toLowerCase().includes(search) ||
                String(item.corporateName || '').toLowerCase().includes(search) ||
                String(item.prefecture || '').toLowerCase().includes(search) ||
                String(item.userCount || '').toLowerCase().includes(search)
            );
        });
    }

    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit);

    res.json({
        data,
        total: filtered.length,
        page,
        limit,
        totalPages: Math.ceil(filtered.length / limit),
    });
});

app.get('/api/export/csv', (_req, res) => {
    if (!currentData.length) {
        return res.status(404).json({ error: 'エクスポートするデータがありません。' });
    }
    const csv = toCSV(currentData);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kaigo_data.csv"');
    res.send(csv);
});

app.get('/api/export/excel', (_req, res) => {
    if (!currentData.length) {
        return res.status(404).json({ error: 'エクスポートするデータがありません。' });
    }
    const buffer = toExcel(currentData);
    res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="kaigo_data.xlsx"');
    res.send(Buffer.from(buffer));
});

app.delete('/api/data', (_req, res) => {
    currentData = [];
    res.json({ success: true });
});

app.listen(PORT, HOST, () => {
    console.log('\nServer started');
    console.log(`  http://${HOST}:${PORT}`);
    console.log(`  API: http://${HOST}:${PORT}/api/prefectures\n`);
});
