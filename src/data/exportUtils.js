/**
 * CSVエクスポート（ブラウザ上で実行）
 */
export function exportToCSV(data) {
    if (!data || data.length === 0) return;

    const headers = [
        '都道府県', '事業所番号', '事業所名', '郵便番号',
        '住所', '電話番号', 'FAX番号', 'サービス種別',
        '法人名', '法人種別'
    ];

    const rows = data.map((item) =>
        [
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
            .join(',')
    );

    const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    downloadBlob(csv, 'kaigo_data.csv', 'text/csv;charset=utf-8');
}

/**
 * Excelエクスポート（ブラウザ上で実行 - CSV形式で.xlsx拡張子）
 * 注: 軽量化のためTSV/CSV形式でExcel互換ファイルを生成
 */
export function exportToExcel(data) {
    if (!data || data.length === 0) return;

    const headers = [
        '都道府県', '事業所番号', '事業所名', '郵便番号',
        '住所', '電話番号', 'FAX番号', 'サービス種別',
        '法人名', '法人種別'
    ];

    const rows = data.map((item) =>
        [
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
        ].join('\t')
    );

    const tsv = '\uFEFF' + headers.join('\t') + '\n' + rows.join('\n');
    downloadBlob(tsv, 'kaigo_data.xls', 'application/vnd.ms-excel;charset=utf-8');
}

/**
 * Blobをダウンロード
 */
function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
