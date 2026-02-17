const styles = {
    container: {
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--gradient-card)',
    },
    searchInput: {
        width: '280px',
        padding: '8px 14px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-input)',
        color: 'var(--text-primary)',
        fontSize: '0.85rem',
        outline: 'none',
        transition: 'var(--transition-fast)',
        fontFamily: 'var(--font-family)',
    },
    tableWrap: {
        overflowX: 'auto',
        maxHeight: '60vh',
        overflowY: 'auto',
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '0.82rem',
    },
    th: {
        position: 'sticky',
        top: 0,
        background: 'var(--bg-secondary)',
        color: 'var(--text-accent)',
        padding: '10px 12px',
        textAlign: 'left',
        fontWeight: 600,
        borderBottom: '2px solid var(--accent-primary)',
        whiteSpace: 'nowrap',
        zIndex: 1,
    },
    td: {
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        color: 'var(--text-secondary)',
        maxWidth: '280px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    pagination: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '12px',
        borderTop: '1px solid var(--border-color)',
    },
    pageBtn: {
        padding: '6px 12px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-card)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: '0.8rem',
        transition: 'var(--transition-fast)',
    },
    pageBtnActive: {
        background: 'var(--accent-primary)',
        color: '#fff',
        border: '1px solid var(--accent-primary)',
    },
    pageBtnDisabled: {
        opacity: 0.4,
        cursor: 'not-allowed',
    },
    empty: {
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '0.95rem',
    },
    emptyIcon: {
        fontSize: '2rem',
        marginBottom: '12px',
        display: 'block',
    },
    count: {
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
    },
};

export default function ResultsTable({
    results,
    totalResults,
    currentPage,
    totalPages,
    searchQuery,
    onSearchChange,
    onPageChange,
}) {
    const columns = [
        { key: 'prefecture', label: '都道府県', width: '80px' },
        { key: 'jigyoushoNumber', label: '事業所番号', width: '110px' },
        { key: 'name', label: '事業所名', width: '200px' },
        { key: 'postalCode', label: '郵便番号', width: '80px' },
        { key: 'address', label: '住所', width: '250px' },
        { key: 'phone', label: '電話番号', width: '120px' },
        { key: 'fax', label: 'FAX番号', width: '120px' },
        { key: 'userCount', label: '利用者人数', width: '90px' },
        { key: 'serviceType', label: 'サービス種別', width: '150px' },
        { key: 'corporateName', label: '法人名', width: '180px' },
    ];

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <span style={styles.count}>
                    {totalResults > 0 ? `全 ${totalResults.toLocaleString()} 件` : 'データなし'}
                </span>
                <input
                    type="text"
                    placeholder="事業所名・住所で検索..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    style={styles.searchInput}
                    onFocus={(e) => {
                        e.target.style.borderColor = 'var(--accent-primary)';
                        e.target.style.boxShadow = 'var(--shadow-glow)';
                    }}
                    onBlur={(e) => {
                        e.target.style.borderColor = 'var(--border-color)';
                        e.target.style.boxShadow = 'none';
                    }}
                />
            </div>

            <div style={styles.tableWrap}>
                {results.length === 0 ? (
                    <div style={styles.empty}>
                        <span style={styles.emptyIcon}>--</span>
                        データを取得してください
                    </div>
                ) : (
                    <table style={styles.table}>
                        <thead>
                            <tr>
                                {columns.map((col) => (
                                    <th key={col.key} style={{ ...styles.th, width: col.width }}>
                                        {col.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((item, idx) => (
                                <tr
                                    key={idx}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'var(--bg-card-hover)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'transparent';
                                    }}
                                >
                                    {columns.map((col) => (
                                        <td
                                            key={col.key}
                                            style={styles.td}
                                            title={resolveCellValue(item, col.key)}
                                        >
                                            {resolveCellValue(item, col.key)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {totalPages > 1 && (
                <div style={styles.pagination}>
                    <button
                        style={{
                            ...styles.pageBtn,
                            ...(currentPage <= 1 ? styles.pageBtnDisabled : {}),
                        }}
                        onClick={() => currentPage > 1 && onPageChange(currentPage - 1)}
                        disabled={currentPage <= 1}
                    >
                        前へ
                    </button>

                    {generatePageNumbers(currentPage, totalPages).map((p, i) =>
                        p === '...' ? (
                            <span key={`dot-${i}`} style={{ color: 'var(--text-muted)' }}>
                                ...
                            </span>
                        ) : (
                            <button
                                key={p}
                                style={{
                                    ...styles.pageBtn,
                                    ...(p === currentPage ? styles.pageBtnActive : {}),
                                }}
                                onClick={() => onPageChange(p)}
                            >
                                {p}
                            </button>
                        )
                    )}

                    <button
                        style={{
                            ...styles.pageBtn,
                            ...(currentPage >= totalPages ? styles.pageBtnDisabled : {}),
                        }}
                        onClick={() =>
                            currentPage < totalPages && onPageChange(currentPage + 1)
                        }
                        disabled={currentPage >= totalPages}
                    >
                        次へ
                    </button>
                </div>
            )}
        </div>
    );
}

function resolveCellValue(item, key) {
    if (key === 'userCount') {
        const raw =
            item?.userCount ??
            item?.totalUserNum ??
            item?.TotalUserNum ??
            item?.['利用者人数'] ??
            item?.['利用者数'];
        const text = String(raw ?? '').trim();
        return text ? text : '-';
    }

    const text = String(item?.[key] ?? '').trim();
    return text ? text : '-';
}

function generatePageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = [];
    pages.push(1);

    if (current > 3) pages.push('...');

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let i = start; i <= end; i++) {
        pages.push(i);
    }

    if (current < total - 2) pages.push('...');

    pages.push(total);

    return pages;
}
