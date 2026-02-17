import { useState } from 'react';

const styles = {
    container: {
        display: 'grid',
        gap: '16px',
    },
    regionGroup: {
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        transition: 'var(--transition-normal)',
    },
    regionHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        cursor: 'pointer',
        background: 'var(--gradient-card)',
        borderBottom: '1px solid var(--border-color)',
        transition: 'var(--transition-fast)',
        userSelect: 'none',
    },
    regionName: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '0.95rem',
        fontWeight: 600,
        color: 'var(--text-primary)',
    },
    regionCount: {
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        background: 'var(--bg-primary)',
        padding: '2px 8px',
        borderRadius: '10px',
    },
    selectAllBtn: {
        fontSize: '0.75rem',
        color: 'var(--accent-primary)',
        background: 'none',
        border: '1px solid var(--accent-primary)',
        borderRadius: '4px',
        padding: '2px 10px',
        cursor: 'pointer',
        transition: 'var(--transition-fast)',
    },
    prefGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
        gap: '6px',
        padding: '12px',
    },
    prefItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'var(--transition-fast)',
        fontSize: '0.85rem',
        color: 'var(--text-secondary)',
        border: '1px solid transparent',
    },
    prefItemSelected: {
        background: 'rgba(99, 102, 241, 0.12)',
        border: '1px solid var(--accent-primary)',
        color: 'var(--text-primary)',
    },
    checkbox: {
        width: '16px',
        height: '16px',
        accentColor: 'var(--accent-primary)',
        cursor: 'pointer',
    },
    controls: {
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
    },
    controlBtn: {
        fontSize: '0.8rem',
        padding: '6px 14px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-card)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'var(--transition-fast)',
    },
};

const regionIcons = {
    '北海道': '🏔️',
    '東北': '🌾',
    '関東': '🏙️',
    '中部': '⛰️',
    '近畿': '⛩️',
    '中国': '🏯',
    '四国': '🌊',
    '九州・沖縄': '🌺',
};

export default function PrefectureSelector({
    prefectures,
    regions,
    selectedPrefectures,
    onSelectionChange,
}) {
    const [collapsed, setCollapsed] = useState({});

    const toggleRegion = (region) => {
        setCollapsed((prev) => ({ ...prev, [region]: !prev[region] }));
    };

    const togglePrefecture = (code) => {
        const newSelected = selectedPrefectures.includes(code)
            ? selectedPrefectures.filter((c) => c !== code)
            : [...selectedPrefectures, code];
        onSelectionChange(newSelected);
    };

    const selectRegion = (region) => {
        const regionPrefs = prefectures
            .filter((p) => p.region === region)
            .map((p) => p.code);

        const allSelected = regionPrefs.every((c) =>
            selectedPrefectures.includes(c)
        );

        let newSelected;
        if (allSelected) {
            newSelected = selectedPrefectures.filter(
                (c) => !regionPrefs.includes(c)
            );
        } else {
            newSelected = [
                ...new Set([...selectedPrefectures, ...regionPrefs]),
            ];
        }
        onSelectionChange(newSelected);
    };

    const selectAll = () => {
        if (selectedPrefectures.length === prefectures.length) {
            onSelectionChange([]);
        } else {
            onSelectionChange(prefectures.map((p) => p.code));
        }
    };

    const clearAll = () => onSelectionChange([]);

    return (
        <div style={styles.container}>
            <div style={styles.controls}>
                <button
                    style={styles.controlBtn}
                    onClick={selectAll}
                    onMouseEnter={(e) => {
                        e.target.style.borderColor = 'var(--accent-primary)';
                        e.target.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.borderColor = 'var(--border-color)';
                        e.target.style.color = 'var(--text-secondary)';
                    }}
                >
                    {selectedPrefectures.length === prefectures.length
                        ? '✓ 全選択中'
                        : '全選択'}
                </button>
                <button
                    style={styles.controlBtn}
                    onClick={clearAll}
                    onMouseEnter={(e) => {
                        e.target.style.borderColor = 'var(--accent-danger)';
                        e.target.style.color = 'var(--accent-danger)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.borderColor = 'var(--border-color)';
                        e.target.style.color = 'var(--text-secondary)';
                    }}
                >
                    クリア
                </button>
                <span
                    style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-accent)',
                        display: 'flex',
                        alignItems: 'center',
                        marginLeft: '8px',
                    }}
                >
                    {selectedPrefectures.length} / {prefectures.length} 選択中
                </span>
            </div>

            {regions.map((region) => {
                const regionPrefs = prefectures.filter((p) => p.region === region);
                const selectedCount = regionPrefs.filter((p) =>
                    selectedPrefectures.includes(p.code)
                ).length;
                const isCollapsed = collapsed[region];

                return (
                    <div key={region} style={styles.regionGroup}>
                        <div
                            style={styles.regionHeader}
                            onClick={() => toggleRegion(region)}
                        >
                            <span style={styles.regionName}>
                                <span>{regionIcons[region] || '📍'}</span>
                                {region}
                                <span style={styles.regionCount}>
                                    {selectedCount}/{regionPrefs.length}
                                </span>
                            </span>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button
                                    style={styles.selectAllBtn}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        selectRegion(region);
                                    }}
                                >
                                    {selectedCount === regionPrefs.length ? '解除' : '一括選択'}
                                </button>
                                <span
                                    style={{
                                        transition: 'var(--transition-fast)',
                                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0)',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    ▼
                                </span>
                            </div>
                        </div>

                        {!isCollapsed && (
                            <div style={styles.prefGrid}>
                                {regionPrefs.map((pref) => {
                                    const isSelected = selectedPrefectures.includes(pref.code);
                                    return (
                                        <div
                                            key={pref.code}
                                            style={{
                                                ...styles.prefItem,
                                                ...(isSelected ? styles.prefItemSelected : {}),
                                            }}
                                            onClick={() => togglePrefecture(pref.code)}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => { }}
                                                style={styles.checkbox}
                                            />
                                            {pref.name}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
