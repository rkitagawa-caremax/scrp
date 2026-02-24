const styles = {
    container: {
        display: 'grid',
        gap: '8px',
    },
    item: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 14px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'var(--transition-fast)',
        fontSize: '0.85rem',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-card)',
    },
    itemSelected: {
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
        marginBottom: '8px',
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
    count: {
        fontSize: '0.8rem',
        color: 'var(--text-accent)',
        display: 'flex',
        alignItems: 'center',
        marginLeft: '8px',
    },
};

const serviceIcons = {
    houmon_kaigo: '🚶',
    houmon_nyuyoku: '🛁',
    houmon_kango: '🩺',
    houmon_rehab: '🧘',
    tsusho_kaigo: '🏢',
    tsusho_rehab: '🏃',
    tanki_seikatsu: '🛏️',
    tanki_ryoyo: '🏥',
    tokutei_shisetsu: '🏠',
    fukushi_yogu: '🦽',
    kaigo_rojin_fukushi: '👴',
    kaigo_rojin_hoken: '🧓',
    kaigo_iryoin: '💊',
    ninchi_group: '👥',
    kyotaku_shien: '📋',
    chiiki_houkatsu: '🗺️',
};

export default function ServiceTypeSelector({
    serviceTypes,
    selectedServices,
    onSelectionChange,
    maxSelectable = Infinity,
    onLimitReached,
}) {
    const toggleService = (id) => {
        const isSelected = selectedServices.includes(id);
        if (!isSelected && selectedServices.length >= maxSelectable) {
            if (typeof onLimitReached === 'function') {
                onLimitReached(maxSelectable);
            }
            return;
        }

        const newSelected = isSelected
            ? selectedServices.filter((s) => s !== id)
            : [...selectedServices, id];
        onSelectionChange(newSelected);
    };

    const selectAll = () => {
        if (selectedServices.length > 0) {
            onSelectionChange([]);
        } else {
            const allIds = serviceTypes.map((s) => s.id);
            const limitedIds = allIds.slice(0, Math.max(1, Number(maxSelectable) || 1));
            onSelectionChange(limitedIds);
            if (allIds.length > limitedIds.length && typeof onLimitReached === 'function') {
                onLimitReached(maxSelectable);
            }
        }
    };

    return (
        <div>
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
                    {selectedServices.length > 0 ? '選択解除' : '上位4件を選択'}
                </button>
                <button
                    style={styles.controlBtn}
                    onClick={() => onSelectionChange([])}
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
                <span style={styles.count}>
                    {selectedServices.length} / {Math.min(serviceTypes.length, maxSelectable)} 選択中
                </span>
            </div>

            <div style={styles.container}>
                {serviceTypes.map((service) => {
                    const isSelected = selectedServices.includes(service.id);
                    const isDisabled = !isSelected && selectedServices.length >= maxSelectable;
                    return (
                        <div
                            key={service.id}
                            style={{
                                ...styles.item,
                                ...(isSelected ? styles.itemSelected : {}),
                                ...(isDisabled
                                    ? { opacity: 0.45, cursor: 'not-allowed' }
                                    : {}),
                            }}
                            onClick={() => {
                                if (!isDisabled) toggleService(service.id);
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isDisabled}
                                onChange={() => { }}
                                style={styles.checkbox}
                            />
                            <span>{serviceIcons[service.id] || '📌'}</span>
                            <span>{service.name}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


