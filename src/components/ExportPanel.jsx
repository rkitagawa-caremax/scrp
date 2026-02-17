const styles = {
    container: {
        display: 'flex',
        gap: '10px',
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    btn: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '10px 20px',
        borderRadius: 'var(--radius-sm)',
        border: 'none',
        cursor: 'pointer',
        fontSize: '0.85rem',
        fontWeight: 500,
        fontFamily: 'var(--font-family)',
        transition: 'var(--transition-fast)',
    },
    csvBtn: {
        background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
        color: '#fff',
        boxShadow: '0 2px 8px rgba(34, 197, 94, 0.3)',
    },
    excelBtn: {
        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
        color: '#fff',
        boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
    },
    clearBtn: {
        background: 'var(--bg-card)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-color)',
    },
    disabled: {
        opacity: 0.5,
        cursor: 'not-allowed',
    },
};

export default function ExportPanel({ totalResults, onExport, onClear }) {
    const hasData = totalResults > 0;

    return (
        <div style={styles.container}>
            <button
                style={{
                    ...styles.btn,
                    ...styles.csvBtn,
                    ...(!hasData ? styles.disabled : {}),
                }}
                onClick={() => hasData && onExport('csv')}
                disabled={!hasData}
                onMouseEnter={(e) => {
                    if (hasData) e.target.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                    e.target.style.transform = 'translateY(0)';
                }}
            >
                📄 CSVエクスポート
            </button>
            <button
                style={{
                    ...styles.btn,
                    ...styles.excelBtn,
                    ...(!hasData ? styles.disabled : {}),
                }}
                onClick={() => hasData && onExport('excel')}
                disabled={!hasData}
                onMouseEnter={(e) => {
                    if (hasData) e.target.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                    e.target.style.transform = 'translateY(0)';
                }}
            >
                📊 Excelエクスポート
            </button>
            <button
                style={{
                    ...styles.btn,
                    ...styles.clearBtn,
                    ...(!hasData ? styles.disabled : {}),
                }}
                onClick={() => hasData && onClear()}
                disabled={!hasData}
                onMouseEnter={(e) => {
                    if (hasData) {
                        e.target.style.borderColor = 'var(--accent-danger)';
                        e.target.style.color = 'var(--accent-danger)';
                    }
                }}
                onMouseLeave={(e) => {
                    e.target.style.borderColor = 'var(--border-color)';
                    e.target.style.color = 'var(--text-secondary)';
                }}
            >
                🗑️ データクリア
            </button>
            {hasData && (
                <span
                    style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-accent)',
                        marginLeft: '4px',
                    }}
                >
                    {totalResults.toLocaleString()}件のデータ
                </span>
            )}
        </div>
    );
}
