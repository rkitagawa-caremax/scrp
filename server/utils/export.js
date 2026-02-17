import XLSX from 'xlsx';

function getBusinessNumber(item) {
    return item.jigyoushoNumber || item.businessNumber || '';
}

function getUserCount(item) {
    const candidates = [
        item?.userCount,
        item?.totalUserNum,
        item?.TotalUserNum,
        item?.user_count,
    ];
    const first = candidates.find(
        (value) => value !== undefined && value !== null && String(value).trim() !== ''
    );
    if (first === undefined) return '';
    const digits = String(first).replace(/[^\d]/g, '');
    return digits || String(first).trim();
}

function toRow(item) {
    return [
        item.prefecture || '',
        getBusinessNumber(item),
        item.name || '',
        item.postalCode || '',
        item.address || '',
        item.phone || '',
        item.fax || '',
        getUserCount(item),
        item.serviceType || '',
        item.corporateName || '',
        item.corporateType || '',
    ];
}

/**
 * Convert records to CSV.
 */
export function toCSV(data) {
    if (!data || data.length === 0) return '';

    const headers = [
        '都道府県',
        '事業所番号',
        '事業所名',
        '郵便番号',
        '住所',
        '電話番号',
        'FAX番号',
        '利用者人数',
        'サービス種別',
        '法人名',
        '法人種別',
    ];

    const rows = data.map((item) =>
        toRow(item)
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
    );

    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

/**
 * Convert records to Excel.
 */
export function toExcel(data) {
    if (!data || data.length === 0) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([['データがありません']]);
        XLSX.utils.book_append_sheet(wb, ws, '事業所一覧');
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }

    const headers = [
        '都道府県',
        '事業所番号',
        '事業所名',
        '郵便番号',
        '住所',
        '電話番号',
        'FAX番号',
        '利用者人数',
        'サービス種別',
        '法人名',
        '法人種別',
    ];

    const rows = data.map((item) => toRow(item));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    ws['!cols'] = [
        { wch: 10 },
        { wch: 14 },
        { wch: 30 },
        { wch: 10 },
        { wch: 40 },
        { wch: 16 },
        { wch: 16 },
        { wch: 12 },
        { wch: 20 },
        { wch: 30 },
        { wch: 12 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, '事業所一覧');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
