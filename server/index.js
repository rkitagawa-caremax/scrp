import express from 'express';
import cors from 'cors';
import { PREFECTURES, REGIONS, SERVICE_TYPES } from './utils/prefectures.js';
import { fetchOpenData } from './scrapers/opendata.js';
import { scrapeWebData } from './scrapers/web-scraper.js';
import { scrapeFromMultipleSources } from './scrapers/multi-source.js';
import { dedupeRecords } from './scrapers/record-normalizer.js';
import { toCSV, toExcel } from './utils/export.js';

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const MAX_SERVICE_TYPES_PER_REQUEST = 4;

const MAX_STORED_JOBS = 30;
const MAX_JOB_LOGS = 400;
const JOB_METHODS = new Set(['multi', 'opendata', 'web']);
const METHOD_LABELS = {
    multi: '複数ソース取得',
    opendata: '公式オープンデータ取得',
    web: 'Webスクレイピング',
};

app.use(cors());
app.use(express.json());

let currentData = [];
let currentDataJobId = '';
let activeScrapeJob = null;

const sseClients = new Set();
const jobs = new Map();
const jobQueue = [];
let queueWorkerRunning = false;

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

function nowIso(ts = Date.now()) {
    return new Date(ts).toISOString();
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

function getQueuePosition(jobId) {
    const idx = jobQueue.indexOf(jobId);
    return idx >= 0 ? idx + 1 : 0;
}

function trimFinishedJobs() {
    if (jobs.size <= MAX_STORED_JOBS) return;

    const candidates = [...jobs.values()]
        .filter(
            (job) =>
                (job.status === 'completed' || job.status === 'failed') &&
                job.id !== currentDataJobId
        )
        .sort((a, b) => {
            const aTime = Number(a.finishedAt || a.createdAt || 0);
            const bTime = Number(b.finishedAt || b.createdAt || 0);
            return aTime - bTime;
        });

    for (const job of candidates) {
        if (jobs.size <= MAX_STORED_JOBS) break;
        jobs.delete(job.id);
    }
}

function pushJobLog(job, data) {
    if (!job) return;

    const entry = {
        seq: job.logSeq + 1,
        time: nowIso(),
        phase: data?.phase || 'scrape',
        message: String(data?.message || ''),
        progress:
            typeof data?.progress === 'number'
                ? data.progress
                : typeof job.progress?.progress === 'number'
                  ? job.progress.progress
                  : -1,
    };

    job.logSeq = entry.seq;
    job.logs.push(entry);
    if (job.logs.length > MAX_JOB_LOGS) {
        job.logs.splice(0, job.logs.length - MAX_JOB_LOGS);
    }
    job.progress = {
        phase: entry.phase,
        message: entry.message,
        progress: entry.progress,
    };

    broadcastProgress({
        jobId: job.id,
        status: job.status,
        ...job.progress,
        time: entry.time,
        seq: entry.seq,
    });
}

function buildJobStatus(job, afterSeq = 0, maxLogs = MAX_JOB_LOGS) {
    const safeAfter = Number.isFinite(afterSeq) ? Math.max(0, afterSeq) : 0;
    const safeMaxLogs = Number.isFinite(maxLogs)
        ? Math.max(0, Math.min(MAX_JOB_LOGS, maxLogs))
        : MAX_JOB_LOGS;
    let logs =
        safeAfter > 0 ? job.logs.filter((entry) => entry.seq > safeAfter) : [...job.logs];
    if (safeMaxLogs === 0) {
        logs = [];
    } else if (logs.length > safeMaxLogs) {
        logs = logs.slice(-safeMaxLogs);
    }

    return {
        jobId: job.id,
        method: job.method,
        status: job.status,
        queuePosition: job.status === 'queued' ? getQueuePosition(job.id) : 0,
        createdAt: nowIso(job.createdAt),
        startedAt: job.startedAt ? nowIso(job.startedAt) : null,
        finishedAt: job.finishedAt ? nowIso(job.finishedAt) : null,
        progress: job.progress,
        total: job.total,
        accumulatedTotal: currentData.length,
        sourceStats: job.sourceStats,
        error: job.error || '',
        lastLogSeq: job.logSeq,
        hasResult: job.status === 'completed',
        logs,
    };
}

function createScrapeJob({
    method,
    prefectureCodes,
    serviceTypeIds,
    appendToCurrentData = false,
    resetCurrentData = false,
}) {
    const job = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method,
        prefectureCodes: [...prefectureCodes],
        serviceTypeIds: [...serviceTypeIds],
        appendToCurrentData: Boolean(appendToCurrentData),
        resetCurrentData: Boolean(resetCurrentData),
        status: 'queued',
        createdAt: Date.now(),
        startedAt: 0,
        finishedAt: 0,
        progress: {
            phase: 'queued',
            message: 'ジョブをキューに登録しました',
            progress: 0,
        },
        logs: [],
        logSeq: 0,
        records: [],
        total: 0,
        sourceStats: [],
        error: '',
    };

    jobs.set(job.id, job);
    pushJobLog(job, {
        phase: 'queued',
        message: `${METHOD_LABELS[method] || method} ジョブを受け付けました`,
        progress: 0,
    });
    return job;
}

async function runScrapeMethod(method, prefectureCodes, serviceTypeIds, onProgress) {
    if (method === 'multi') {
        const result = await scrapeFromMultipleSources(prefectureCodes, serviceTypeIds, onProgress);
        return {
            records: result.records || [],
            sourceStats: Array.isArray(result.sourceStats) ? result.sourceStats : [],
        };
    }

    if (method === 'opendata') {
        const records = await fetchOpenData(prefectureCodes, serviceTypeIds, onProgress);
        if (!records.length) {
            throw new Error(
                '公式オープンデータから取得できませんでした。条件を変更して再実行してください。'
            );
        }
        return {
            records,
            sourceStats: [
                {
                    source: 'official-opendata',
                    count: records.length,
                    status: 'ok',
                },
            ],
        };
    }

    if (method === 'web') {
        const records = await scrapeWebData(prefectureCodes, serviceTypeIds, onProgress);
        if (!records.length) {
            throw new Error(
                'Webスクレイピングで取得できませんでした。条件を変更して再実行してください。'
            );
        }
        return {
            records,
            sourceStats: [
                {
                    source: 'web-scraping',
                    count: records.length,
                    status: 'ok',
                },
            ],
        };
    }

    throw new Error(`未対応のジョブ種別です: ${method}`);
}

async function executeScrapeJob(job) {
    job.status = 'running';
    job.startedAt = Date.now();
    job.error = '';
    activeScrapeJob = {
        id: job.id,
        kind: job.method,
        running: true,
        startedAt: job.startedAt,
    };

    pushJobLog(job, {
        phase: 'start',
        message: `${METHOD_LABELS[job.method] || job.method} を開始します...`,
        progress: 0,
    });

    try {
        const { records, sourceStats } = await runScrapeMethod(
            job.method,
            job.prefectureCodes,
            job.serviceTypeIds,
            (progressData) => pushJobLog(job, progressData)
        );

        const normalized = records.map(normalizeRecordShape);
        job.records = normalized;
        job.total = normalized.length;
        job.sourceStats = sourceStats;
        job.status = 'completed';
        job.finishedAt = Date.now();

        if (job.resetCurrentData) {
            currentData = [];
            currentDataJobId = '';
        }

        if (job.appendToCurrentData) {
            currentData = dedupeRecords([...currentData, ...normalized]);
        } else {
            currentData = normalized;
        }
        currentDataJobId = job.id;

        pushJobLog(job, {
            phase: 'complete',
            message: `取得完了: ${job.total.toLocaleString()}件`,
            progress: 100,
        });
    } catch (error) {
        job.status = 'failed';
        job.finishedAt = Date.now();
        job.error = String(error?.message || 'スクレイピング処理に失敗しました。');
        pushJobLog(job, {
            phase: 'error',
            message: `エラー: ${job.error}`,
            progress: 0,
        });
    } finally {
        if (activeScrapeJob && activeScrapeJob.id === job.id) {
            activeScrapeJob = null;
        }
    }
}

async function processJobQueue() {
    if (queueWorkerRunning) return;
    queueWorkerRunning = true;

    try {
        while (jobQueue.length > 0) {
            const jobId = jobQueue.shift();
            const job = jobs.get(jobId);
            if (!job || job.status !== 'queued') continue;
            await executeScrapeJob(job);
            trimFinishedJobs();
        }
    } finally {
        queueWorkerRunning = false;
    }
}

function enqueueJob(job) {
    jobQueue.push(job.id);
    processJobQueue().catch((error) => {
        console.error('Job queue worker crashed:', error);
    });
}

function acceptScrapeJob(res, payload) {
    const job = createScrapeJob(payload);
    enqueueJob(job);
    return res.status(202).json({
        accepted: true,
        jobId: job.id,
        status: job.status,
        queuePosition: getQueuePosition(job.id),
        pollUrl: `/api/jobs/${job.id}`,
        resultUrl: `/api/jobs/${job.id}/result`,
    });
}

function validateScrapeRequest(req, res, forcedMethod = '') {
    const { prefectureCodes, serviceTypeIds } = req.body || {};
    const method = String(forcedMethod || req.body?.method || 'multi').trim();
    const appendToCurrentData = Boolean(req.body?.appendToCurrentData);
    const resetCurrentData = Boolean(req.body?.resetCurrentData);

    if (!JOB_METHODS.has(method)) {
        res.status(400).json({ error: 'method は multi / opendata / web のいずれかを指定してください。' });
        return null;
    }
    if (!Array.isArray(prefectureCodes) || prefectureCodes.length === 0) {
        res.status(400).json({ error: '都道府県を選択してください。' });
        return null;
    }
    if (!Array.isArray(serviceTypeIds) || serviceTypeIds.length === 0) {
        res.status(400).json({ error: 'サービス種別を選択してください。' });
        return null;
    }
    if (serviceTypeIds.length > MAX_SERVICE_TYPES_PER_REQUEST) {
        res.status(400).json({
            error: `serviceTypeIds must be ${MAX_SERVICE_TYPES_PER_REQUEST} or fewer`,
        });
        return null;
    }


    return {
        method,
        prefectureCodes,
        serviceTypeIds,
        appendToCurrentData,
        resetCurrentData,
    };
}

function resolveRecordsByRequest(req, res) {
    const requestedJobId = String(req.query.jobId || '').trim();
    if (!requestedJobId) {
        return { records: currentData, jobId: currentDataJobId || '' };
    }

    const job = jobs.get(requestedJobId);
    if (!job) {
        res.status(404).json({ error: `job not found: ${requestedJobId}` });
        return null;
    }
    if (job.status !== 'completed') {
        res.status(409).json({
            error: `job is not completed yet: ${requestedJobId}`,
            status: job.status,
        });
        return null;
    }

    return { records: job.records || [], jobId: requestedJobId };
}

app.get('/api/prefectures', (_req, res) => {
    res.json({ prefectures: PREFECTURES, regions: REGIONS });
});

app.get('/api/service-types', (_req, res) => {
    res.json({ serviceTypes: SERVICE_TYPES });
});

app.get('/api/health', (_req, res) => {
    const running = activeScrapeJob
        ? {
              running: true,
              jobId: activeScrapeJob.id,
              kind: activeScrapeJob.kind,
              startedAt: nowIso(activeScrapeJob.startedAt),
          }
        : { running: false };

    const counts = {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
    };
    for (const job of jobs.values()) {
        if (job.status in counts) counts[job.status] += 1;
    }

    res.json({
        ok: true,
        timestamp: nowIso(),
        scraping: running,
        queue: { length: jobQueue.length },
        jobs: {
            total: jobs.size,
            ...counts,
        },
        currentDataJobId: currentDataJobId || null,
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

app.post('/api/jobs', (req, res) => {
    const payload = validateScrapeRequest(req, res);
    if (!payload) return;
    acceptScrapeJob(res, payload);
});

app.post('/api/scrape/multi', (req, res) => {
    const payload = validateScrapeRequest(req, res, 'multi');
    if (!payload) return;
    acceptScrapeJob(res, payload);
});

app.post('/api/scrape/opendata', (req, res) => {
    const payload = validateScrapeRequest(req, res, 'opendata');
    if (!payload) return;
    acceptScrapeJob(res, payload);
});

app.post('/api/scrape/web', (req, res) => {
    const payload = validateScrapeRequest(req, res, 'web');
    if (!payload) return;
    acceptScrapeJob(res, payload);
});

app.get('/api/jobs/:jobId', (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    const job = jobs.get(jobId);
    if (!job) {
        return res.status(404).json({ error: `job not found: ${jobId}` });
    }

    const afterSeq = Math.max(0, Number.parseInt(String(req.query.after || '0'), 10) || 0);
    const requestedMaxLogs = Number.parseInt(String(req.query.maxLogs || '80'), 10);
    const maxLogs = Number.isFinite(requestedMaxLogs) ? requestedMaxLogs : 80;
    res.json(buildJobStatus(job, afterSeq, maxLogs));
});

app.get('/api/jobs/:jobId/result', (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    const job = jobs.get(jobId);
    if (!job) {
        return res.status(404).json({ error: `job not found: ${jobId}` });
    }

    if (job.status === 'failed') {
        return res.status(409).json({
            jobId: job.id,
            status: job.status,
            error: job.error || 'job failed',
        });
    }

    if (job.status !== 'completed') {
        return res.status(202).json({
            jobId: job.id,
            status: job.status,
            progress: job.progress,
        });
    }

    return res.json({
        success: true,
        jobId: job.id,
        status: job.status,
        total: job.total,
        accumulatedTotal: currentData.length,
        sourceStats: job.sourceStats,
        data: (job.records || []).slice(0, 100),
    });
});

app.get('/api/data', (req, res) => {
    const resolved = resolveRecordsByRequest(req, res);
    if (!resolved) return;

    const { records, jobId } = resolved;
    const page = Number.parseInt(req.query.page, 10) || 1;
    const limit = Number.parseInt(req.query.limit, 10) || 50;
    const search = String(req.query.search || '').trim().toLowerCase();

    let filtered = records;
    if (search) {
        filtered = records.filter((item) => {
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
        jobId: jobId || null,
        data,
        total: filtered.length,
        page,
        limit,
        totalPages: Math.ceil(filtered.length / limit),
    });
});

app.get('/api/export/csv', (req, res) => {
    const resolved = resolveRecordsByRequest(req, res);
    if (!resolved) return;

    const { records } = resolved;
    if (!records.length) {
        return res.status(404).json({ error: 'エクスポートするデータがありません。' });
    }

    const csv = toCSV(records);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kaigo_data.csv"');
    res.send(csv);
});

app.get('/api/export/excel', (req, res) => {
    const resolved = resolveRecordsByRequest(req, res);
    if (!resolved) return;

    const { records } = resolved;
    if (!records.length) {
        return res.status(404).json({ error: 'エクスポートするデータがありません。' });
    }

    const buffer = toExcel(records);
    res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="kaigo_data.xlsx"');
    res.send(Buffer.from(buffer));
});

app.delete('/api/data', (req, res) => {
    const requestedJobId = String(req.query.jobId || '').trim();
    if (requestedJobId) {
        const job = jobs.get(requestedJobId);
        if (!job) {
            return res.status(404).json({ error: `job not found: ${requestedJobId}` });
        }
        job.records = [];
        job.total = 0;
        job.sourceStats = [];
        if (currentDataJobId === requestedJobId) {
            currentData = [];
            currentDataJobId = '';
        }
        return res.json({ success: true, jobId: requestedJobId });
    }

    currentData = [];
    currentDataJobId = '';
    res.json({ success: true });
});

app.listen(PORT, HOST, () => {
    console.log('\nServer started');
    console.log(`  http://${HOST}:${PORT}`);
    console.log(`  API: http://${HOST}:${PORT}/api/prefectures`);
    console.log(`  Jobs: http://${HOST}:${PORT}/api/jobs\n`);
});
