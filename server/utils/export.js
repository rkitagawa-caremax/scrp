import XLSX from 'xlsx';

/**
 * 取得データをCSV文字列に変換
 */
export function toCSV(data) {
    if (!data || data.length === 0) return '';

    const headers = [
        '都道府県', '事業所番号', '事業所名', '郵便番号',
        '住所', '電話番号', 'FAX番号', 'サービス種別',
        '法人名', '法人種別'
    ];

    const rows = data.map((item) => {
        return [
            item.prefecture || '',
            item.jigyoushoNumber || '',
            item.name || '',
            item.postalCode || '',
            item.address || '',
            item.phone || '',
            item.fax || '',
            item.serviceType || '',
            item.corporateName || '',
            item.corporateType || '',
        ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(',');
    });

    // BOM付きUTF-8
    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

/**
 * 取得データをExcelバッファに変換
 */
export function toExcel(data) {
    if (!data || data.length === 0) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([['データがありません']]);
        XLSX.utils.book_append_sheet(wb, ws, '事業所一覧');
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }

    const headers = [
        '都道府県', '事業所番号', '事業所名', '郵便番号',
        '住所', '電話番号', 'FAX番号', 'サービス種別',
        '法人名', '法人種別'
    ];

    const rows = data.map((item) => [
        item.prefecture || '',
        item.jigyoushoNumber || '',
        item.name || '',
        item.postalCode || '',
        item.address || '',
        item.phone || '',
        item.fax || '',
        item.serviceType || '',
        item.corporateName || '',
        item.corporateType || '',
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // 列幅の自動調整
    ws['!cols'] = [
        { wch: 10 }, // 都道府県
        { wch: 14 }, // 事業所番号
        { wch: 30 }, // 事業所名
        { wch: 10 }, // 郵便番号
        { wch: 40 }, // 住所
        { wch: 16 }, // 電話番号
        { wch: 16 }, // FAX番号
        { wch: 20 }, // サービス種別
        { wch: 30 }, // 法人名
        { wch: 12 }, // 法人種別
    ];

    XLSX.utils.book_append_sheet(wb, ws, '事業所一覧');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
