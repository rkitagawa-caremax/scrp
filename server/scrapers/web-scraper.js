import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { PREFECTURES } from '../utils/prefectures.js';
import { dedupeRecords } from './record-normalizer.js';

/**
 * 介護サービス情報公表システムのWebスクレイピング
 * 各都道府県のシステムから事業所情報を取得
 */

// リクエスト間隔（ミリ秒）- サーバー負荷軽減
const REQUEST_DELAY = 2000;
const MAX_RETRIES = 3;

/**
 * Webスクレイピングで事業所情報を取得
 * @param {string[]} prefectureCodes - 都道府県コード配列
 * @param {string[]} serviceTypeIds - サービス種別ID配列
 * @param {function} onProgress - 進捗コールバック
 * @returns {Promise<object[]>}
 */
export async function scrapeWebData(prefectureCodes, serviceTypeIds, onProgress) {
    const results = [];
    const selectedPrefs = PREFECTURES.filter((p) => prefectureCodes.includes(p.code));
    const totalPrefs = selectedPrefs.length;
    let completedPrefs = 0;

    for (const pref of selectedPrefs) {
        try {
            onProgress?.({
                phase: 'scrape',
                message: `${pref.name}のデータをスクレイピング中...`,
                progress: Math.round((completedPrefs / totalPrefs) * 100),
            });

            const prefResults = await scrapePrefecture(pref, serviceTypeIds, onProgress);
            results.push(...prefResults);

            onProgress?.({
                phase: 'scrape',
                message: `${pref.name}: ${prefResults.length}件取得完了`,
                progress: Math.round(((completedPrefs + 1) / totalPrefs) * 100),
            });
        } catch (err) {
            onProgress?.({
                phase: 'error',
                message: `${pref.name}のスクレイピングでエラー: ${err.message}`,
                progress: Math.round(((completedPrefs + 1) / totalPrefs) * 100),
            });
        }

        completedPrefs++;
        await delay(REQUEST_DELAY);
    }

    return dedupeRecords(results);
}

/**
 * 特定都道府県の事業所一覧をスクレイピング
 */
async function scrapePrefecture(pref, serviceTypeIds, onProgress) {
    const results = [];
    const baseUrl = `https://www.kaigokensaku.mhlw.go.jp/${pref.code}/index.php`;

    try {
        // サービス種別のコードマッピング
        const serviceCodeMap = {
            'houmon_kaigo': '11',
            'houmon_nyuyoku': '12',
            'houmon_kango': '13',
            'houmon_rehab': '14',
            'tsusho_kaigo': '15',
            'tsusho_rehab': '16',
            'tanki_seikatsu': '21',
            'tanki_ryoyo': '22',
            'tokutei_shisetsu': '33',
            'fukushi_yogu': '17',
            'kaigo_rojin_fukushi': '54',
            'kaigo_rojin_hoken': '55',
            'kaigo_iryoin': '56',
            'ninchi_group': '32',
            'kyotaku_shien': '46',
            'chiiki_houkatsu': '60',
        };

        for (const serviceId of serviceTypeIds) {
            const serviceCode = serviceCodeMap[serviceId];
            if (!serviceCode) continue;

            try {
                // 検索ページにアクセスしてフォームデータを送信
                const searchUrl = `https://www.kaigokensaku.mhlw.go.jp/${pref.code}/index.php?action_kouhyou_pref_search_list_list=true&SJCDServiceTypeCd=${serviceCode}`;

                const searchResults = await fetchWithRetry(searchUrl);
                if (!searchResults) continue;

                const $ = cheerio.load(searchResults);
                const facilities = [];

                // 事業所一覧から情報を抽出
                $('table.datatable tbody tr, .search-result-item, .jigyousho-item').each((i, el) => {
                    const $el = $(el);
                    const facility = extractFacilityInfo($, $el, pref.name);
                    if (facility && facility.name) {
                        facility.serviceType = getServiceName(serviceId);
                        facilities.push(facility);
                    }
                });

                // リスト形式のレイアウトもサポート
                if (facilities.length === 0) {
                    $('.result-list li, .list-item, div.result-item').each((i, el) => {
                        const $el = $(el);
                        const facility = extractFacilityFromList($, $el, pref.name);
                        if (facility && facility.name) {
                            facility.serviceType = getServiceName(serviceId);
                            facilities.push(facility);
                        }
                    });
                }

                // ページ全体からテーブルデータを抽出
                if (facilities.length === 0) {
                    $('table').each((i, table) => {
                        const $table = $(table);
                        $table.find('tr').each((j, tr) => {
                            if (j === 0) return; // ヘッダーをスキップ
                            const $tr = $(tr);
                            const tds = $tr.find('td');
                            if (tds.length >= 3) {
                                const name = $(tds[0]).text().trim() || $(tds[1]).text().trim();
                                const address = extractAddress($, tds);
                                if (name && name.length > 1) {
                                    facilities.push({
                                        prefecture: pref.name,
                                        jigyoushoNumber: '',
                                        name: name,
                                        postalCode: '',
                                        address: address,
                                        phone: extractPhone($, tds),
                                        fax: extractFax($, tds),
                                        serviceType: getServiceName(serviceId),
                                        corporateName: '',
                                        corporateType: '',
                                        sourceSite: 'kaigokensaku.mhlw.go.jp(web)',
                                    });
                                }
                            }
                        });
                    });
                }

                results.push(...facilities);

                onProgress?.({
                    phase: 'scrape',
                    message: `${pref.name} - ${getServiceName(serviceId)}: ${facilities.length}件`,
                    progress: -1,
                });

                await delay(REQUEST_DELAY);
            } catch (err) {
                console.error(`Error scraping ${pref.name} ${serviceId}:`, err.message);
            }
        }
    } catch (err) {
        console.error(`Error scraping prefecture ${pref.name}:`, err.message);
    }

    return results;
}

/**
 * テーブル行から事業所情報を抽出
 */
function extractFacilityInfo($, $el, prefName) {
    const texts = [];
    $el.find('td').each((i, td) => {
        texts.push($(td).text().trim());
    });

    if (texts.length < 2) return null;

    return {
        prefecture: prefName,
        jigyoushoNumber: texts.find((t) => /^\d{10}$/.test(t)) || '',
        name: texts.find(
            (t) => t.length > 2 && !/^\d+$/.test(t) && !t.includes('〒')
        ) || texts[0],
        postalCode: texts.find((t) => /〒?\d{3}-?\d{4}/.test(t))?.replace(/〒/, '') || '',
        address:
            texts.find(
                (t) =>
                    t.includes('市') ||
                    t.includes('区') ||
                    t.includes('町') ||
                    t.includes('村') ||
                    t.includes('郡')
            ) || '',
        phone: texts.find((t) => /\d{2,4}-\d{2,4}-\d{4}/.test(t)) || '',
        fax: '',
        serviceType: '',
        corporateName: '',
        corporateType: '',
        sourceSite: 'kaigokensaku.mhlw.go.jp(web)',
    };
}

/**
 * リスト形式から事業所情報を抽出
 */
function extractFacilityFromList($, $el, prefName) {
    const text = $el.text();
    const html = $el.html() || '';

    const nameMatch =
        $el.find('a, .name, .title, h3, h4, strong').first().text().trim() ||
        text.split('\n')[0]?.trim();

    const phoneMatch = text.match(/(?:電話|TEL|tel)[：:\s]*(\d{2,4}-\d{2,4}-\d{4})/);
    const faxMatch = text.match(/(?:FAX|fax|ＦＡＸ)[：:\s]*(\d{2,4}-\d{2,4}-\d{4})/);
    const postalMatch = text.match(/〒?(\d{3}-?\d{4})/);
    const addressMatch = text.match(
        /((?:北海道|東京都|(?:大阪|京都)府|.{2,3}県).+?(?:丁目|番地?|号|\d+[-ー]\d+))/
    );

    return {
        prefecture: prefName,
        jigyoushoNumber: '',
        name: nameMatch || '',
        postalCode: postalMatch ? postalMatch[1] : '',
        address: addressMatch ? addressMatch[1] : '',
        phone: phoneMatch ? phoneMatch[1] : '',
        fax: faxMatch ? faxMatch[1] : '',
        serviceType: '',
        corporateName: '',
        corporateType: '',
        sourceSite: 'kaigokensaku.mhlw.go.jp(web)',
    };
}

/**
 * テーブルセルから住所を抽出
 */
function extractAddress($, tds) {
    for (let i = 0; i < tds.length; i++) {
        const text = $(tds[i]).text().trim();
        if (
            text.includes('市') ||
            text.includes('区') ||
            text.includes('町') ||
            text.includes('村') ||
            text.includes('郡') ||
            text.includes('県')
        ) {
            return text;
        }
    }
    return '';
}

/**
 * テーブルセルから電話番号を抽出
 */
function extractPhone($, tds) {
    for (let i = 0; i < tds.length; i++) {
        const text = $(tds[i]).text().trim();
        const match = text.match(/\d{2,4}-\d{2,4}-\d{4}/);
        if (match) return match[0];
    }
    return '';
}

/**
 * テーブルセルからFAX番号を抽出
 */
function extractFax($, tds) {
    for (let i = 0; i < tds.length; i++) {
        const text = $(tds[i]).text().trim();
        if (text.toLowerCase().includes('fax') || text.includes('ＦＡＸ')) {
            const match = text.match(/\d{2,4}-\d{2,4}-\d{4}/);
            if (match) return match[0];
        }
    }
    return '';
}

/**
 * サービスIDからサービス名を取得
 */
function getServiceName(serviceId) {
    const names = {
        houmon_kaigo: '訪問介護',
        houmon_nyuyoku: '訪問入浴介護',
        houmon_kango: '訪問看護',
        houmon_rehab: '訪問リハビリテーション',
        tsusho_kaigo: '通所介護',
        tsusho_rehab: '通所リハビリテーション',
        tanki_seikatsu: '短期入所生活介護',
        tanki_ryoyo: '短期入所療養介護',
        tokutei_shisetsu: '特定施設入居者生活介護',
        fukushi_yogu: '福祉用具貸与',
        kaigo_rojin_fukushi: '介護老人福祉施設',
        kaigo_rojin_hoken: '介護老人保健施設',
        kaigo_iryoin: '介護医療院',
        ninchi_group: '認知症対応型共同生活介護',
        kyotaku_shien: '居宅介護支援',
        chiiki_houkatsu: '地域包括支援センター',
    };
    return names[serviceId] || serviceId;
}

/**
 * HTTPリクエスト（リトライ付き）
 */
async function fetchWithRetry(url, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept:
                        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ja,en;q=0.9',
                },
                timeout: 30000,
            });

            if (!response.ok) {
                if (response.status === 429) {
                    // レート制限 - 待機時間を増やしてリトライ
                    await delay(REQUEST_DELAY * (i + 2));
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.text();
        } catch (err) {
            if (i === retries - 1) throw err;
            await delay(REQUEST_DELAY * (i + 1));
        }
    }
    return null;
}

/**
 * 遅延
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
