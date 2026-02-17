import XLSX from 'xlsx';

/**
 * CSV文字列に変換
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
            item.businessNumber || '',
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

    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

/**
 * Excelバッファに変換
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
        item.businessNumber || '',
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

    ws['!cols'] = [
        { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 10 },
        { wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 20 },
        { wch: 30 }, { wch: 12 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, '事業所一覧');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
