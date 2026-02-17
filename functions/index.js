import functions from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import express from 'express';
import cors from 'cors';
import { toCSV, toExcel } from './utils/export.js';

// Firebase Admin 初期化
initializeApp();
const db = getFirestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ─── ヘルパー関数 ─────────────────────────

/**
 * Firestoreにジョブ進捗を書き込む
 */
async function updateJobProgress(jobId, data) {
    try {
        await db.collection('jobs').doc(jobId).set({
            ...data,
            updatedAt: new Date().toISOString(),
        }, { merge: true });
    } catch (err) {
        console.error('Progress update error:', err);
    }
}

/**
 * Firestoreにデータを保存（チャンク分割）
 */
async function saveDataToFirestore(jobId, data) {
    const batch = db.batch();
    const jobRef = db.collection('jobs').doc(jobId);

    // ジョブメタデータを更新
    batch.set(jobRef, {
        totalResults: data.length,
        status: 'complete',
        updatedAt: new Date().toISOString(),
    }, { merge: true });

    // データを100件ごとのチャンクで保存
    const chunkSize = 100;
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        const chunkRef = jobRef.collection('data').doc(`chunk_${Math.floor(i / chunkSize)}`);
        batch.set(chunkRef, {
            items: chunk,
            startIndex: i,
            count: chunk.length,
        });
    }

    await batch.commit();
}

/**
 * Firestoreからデータを取得
 */
async function getDataFromFirestore(jobId) {
    const chunksSnap = await db.collection('jobs').doc(jobId)
        .collection('data')
        .orderBy('startIndex')
        .get();

    const allData = [];
    chunksSnap.forEach(doc => {
        const chunk = doc.data();
        allData.push(...chunk.items);
    });
    return allData;
}

// ─── API エンドポイント ─────────────────────

/**
 * 旧デモエンドポイント（廃止）
 */
app.post('/scrape/demo', async (req, res) => {
    res.status(410).json({
        error: 'デモモードは廃止されました。実データ取得エンドポイントを利用してください。',
    });
});

/**
 * ジョブの進捗取得
 */
app.get('/job/:jobId', async (req, res) => {
    try {
        const doc = await db.collection('jobs').doc(req.params.jobId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'ジョブが見つかりません' });
        }
        res.json(doc.data());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * データ取得（ページネーション対応）
 */
app.get('/data/:jobId', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = (req.query.search || '').toLowerCase();

    try {
        let allData = await getDataFromFirestore(req.params.jobId);

        if (search) {
            allData = allData.filter(
                (item) =>
                    (item.name || '').toLowerCase().includes(search) ||
                    (item.address || '').toLowerCase().includes(search) ||
                    (item.corporateName || '').toLowerCase().includes(search) ||
                    (item.prefecture || '').includes(search)
            );
        }

        const start = (page - 1) * limit;
        const paged = allData.slice(start, start + limit);

        res.json({
            data: paged,
            total: allData.length,
            page,
            limit,
            totalPages: Math.ceil(allData.length / limit),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * CSVエクスポート
 */
app.get('/export/csv/:jobId', async (req, res) => {
    try {
        const data = await getDataFromFirestore(req.params.jobId);
        if (data.length === 0) {
            return res.status(404).json({ error: 'エクスポートするデータがありません' });
        }

        const csv = toCSV(data);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="kaigo_data.csv"');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Excelエクスポート
 */
app.get('/export/excel/:jobId', async (req, res) => {
    try {
        const data = await getDataFromFirestore(req.params.jobId);
        if (data.length === 0) {
            return res.status(404).json({ error: 'エクスポートするデータがありません' });
        }

        const buffer = toExcel(data);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="kaigo_data.xlsx"');
        res.send(Buffer.from(buffer));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * データ削除
 */
app.delete('/data/:jobId', async (req, res) => {
    try {
        const jobRef = db.collection('jobs').doc(req.params.jobId);
        const chunksSnap = await jobRef.collection('data').get();

        const batch = db.batch();
        chunksSnap.forEach(doc => batch.delete(doc.ref));
        batch.delete(jobRef);
        await batch.commit();

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cloud Function v1 としてエクスポート
export const api = functions
    .region('asia-northeast1')
    .runWith({ timeoutSeconds: 300, memory: '512MB' })
    .https.onRequest(app);
