import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import * as cheerio from 'cheerio';

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 45000;
const MAX_HTML_FOLLOW_DEPTH = 2;

const DEFAULT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'ja,en;q=0.9',
};

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                headers: DEFAULT_HEADERS,
                redirect: 'follow',
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response;
        } catch (error) {
            if (attempt === retries - 1) throw error;
            await delay(1200 * (attempt + 1));
        } finally {
            clearTimeout(timeout);
        }
    }
    return null;
}

function textQualityScore(text) {
    if (!text) return -9999;
    const replacementCount = (text.match(/�/g) || []).length;
    const japaneseCount = (text.match(/[ぁ-んァ-ン一-龠]/g) || []).length;
    const digitCount = (text.match(/\d/g) || []).length;
    const lineCount = (text.match(/\n/g) || []).length;
    return japaneseCount * 2 + digitCount + lineCount - replacementCount * 20;
}

function decodeWithEncoding(buffer, encoding) {
    try {
        const decoder = new TextDecoder(encoding);
        return decoder.decode(buffer);
    } catch {
        return '';
    }
}

function decodeBuffer(buffer) {
    const decoders = [
        (buf) => buf.toString('utf8'),
        (buf) => decodeWithEncoding(buf, 'shift-jis'),
        (buf) => decodeWithEncoding(buf, 'euc-jp'),
    ];

    let bestText = '';
    let bestScore = -9999;

    for (const decode of decoders) {
        try {
            const text = decode(buffer);
            const score = textQualityScore(text);
            if (score > bestScore) {
                bestScore = score;
                bestText = text;
            }
        } catch {
            // ignore decode failure
        }
    }

    return bestText || buffer.toString('utf8');
}

function detectDelimiter(text) {
    const lines = text
        .split('\n')
        .slice(0, 4)
        .filter((line) => line.trim().length > 0);

    if (lines.length === 0) return ',';

    const candidates = [',', '\t', ';'];
    let best = { delimiter: ',', score: -1 };

    for (const delimiter of candidates) {
        const score = lines.reduce(
            (sum, line) => sum + line.split(delimiter).length,
            0
        );
        if (score > best.score) {
            best = { delimiter, score };
        }
    }

    return best.delimiter;
}

function parseCsvText(text) {
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (!normalized.trim()) return [];

    const delimiter = detectDelimiter(normalized);

    return parse(normalized, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
        delimiter,
    });
}

function resolveUrl(baseUrl, href) {
    try {
        return new URL(href, baseUrl).toString();
    } catch {
        return '';
    }
}

function looksLikeCsvOrZip(url) {
    const lower = url.toLowerCase();
    return (
        lower.endsWith('.csv') ||
        lower.endsWith('.zip') ||
        lower.includes('.csv?') ||
        lower.includes('.zip?')
    );
}

async function parseZipBuffer(buffer) {
    const zip = new AdmZip(buffer);
    const entries = zip
        .getEntries()
        .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.csv'));

    const records = [];
    for (const entry of entries) {
        const text = decodeBuffer(entry.getData());
        const parsed = parseCsvText(text);
        if (parsed.length > 0) records.push(...parsed);
    }
    return records;
}

async function parseHtmlForTableLinks(url, html, depth, visited) {
    if (depth >= MAX_HTML_FOLLOW_DEPTH) return [];

    const $ = cheerio.load(html);
    const anchors = [];

    $('a[href]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        if (!href) return;
        const resolved = resolveUrl(url, href);
        if (!resolved) return;

        const lower = resolved.toLowerCase();
        const isDataUrl =
            looksLikeCsvOrZip(lower) ||
            lower.includes('download') ||
            lower.includes('resource') ||
            lower.includes('opendata');

        if (isDataUrl) anchors.push(resolved);
    });

    const uniqueCandidates = [...new Set(anchors)];
    for (const candidate of uniqueCandidates) {
        const records = await downloadRecordsFromUrl(candidate, {
            visited,
            depth: depth + 1,
        });
        if (records.length > 0) return records;
    }

    return [];
}

export async function downloadRecordsFromUrl(url, options = {}) {
    const visited = options.visited || new Set();
    const depth = options.depth || 0;

    if (!url || visited.has(url)) return [];
    visited.add(url);

    let response;
    try {
        response = await fetchWithRetry(url);
    } catch {
        return [];
    }

    if (!response) return [];

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const buffer = Buffer.from(await response.arrayBuffer());
    const urlLower = response.url.toLowerCase();

    const isZip =
        urlLower.endsWith('.zip') ||
        contentType.includes('application/zip') ||
        contentType.includes('application/x-zip-compressed');
    if (isZip) {
        return parseZipBuffer(buffer);
    }

    const isHtml = contentType.includes('text/html');
    if (isHtml) {
        const html = decodeBuffer(buffer);
        return parseHtmlForTableLinks(response.url, html, depth, visited);
    }

    const text = decodeBuffer(buffer);
    try {
        return parseCsvText(text);
    } catch {
        return [];
    }
}
