import { useEffect, useRef } from 'react';

const styles = {
    container: {
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
    },
    progressWrapper: {
        padding: '16px',
    },
    barOuter: {
        width: '100%',
        height: '8px',
        background: 'var(--bg-primary)',
        borderRadius: '4px',
        overflow: 'hidden',
        marginBottom: '12px',
    },
    barInner: {
        height: '100%',
        background: 'var(--gradient-accent)',
        borderRadius: '4px',
        transition: 'width 0.5s ease',
    },
    statusRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
    },
    statusText: {
        fontSize: '0.85rem',
        color: 'var(--text-primary)',
        fontWeight: 500,
    },
    statusPercent: {
        fontSize: '0.85rem',
        color: 'var(--text-accent)',
        fontWeight: 600,
    },
    logContainer: {
        maxHeight: '200px',
        overflowY: 'auto',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px',
    },
    logItem: {
        display: 'flex',
        gap: '8px',
        padding: '4px 8px',
        fontSize: '0.75rem',
        fontFamily: '"Cascadia Code", "Fira Code", monospace',
        lineHeight: 1.5,
    },
    logTime: {
        color: 'var(--text-muted)',
        flexShrink: 0,
    },
    logMsg: {
        color: 'var(--text-secondary)',
    },
    logPhase: {
        flexShrink: 0,
        padding: '0 6px',
        borderRadius: '3px',
        fontSize: '0.7rem',
        fontWeight: 600,
    },
};

const phaseColors = {
    start: { bg: 'rgba(99, 102, 241, 0.2)', color: '#818cf8' },
    download: { bg: 'rgba(6, 182, 212, 0.2)', color: '#06b6d4' },
    parse: { bg: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' },
    scrape: { bg: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' },
    complete: { bg: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' },
    error: { bg: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' },
};

export default function ProgressBar({ progress, logs, isLoading }) {
    const logEndRef = useRef(null);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs.length]);

    const percent = progress.progress >= 0 ? progress.progress : 0;

    if (!isLoading && logs.length === 0) return null;

    return (
        <div style={styles.container}>
            <div style={styles.progressWrapper}>
                <div style={styles.statusRow}>
                    <span style={styles.statusText}>
                        {isLoading ? '⏳ ' : progress.phase === 'complete' ? '✅ ' : ''}
                        {progress.message || '待機中...'}
                    </span>
                    <span style={styles.statusPercent}>{percent}%</span>
                </div>

                <div style={styles.barOuter}>
                    <div
                        style={{
                            ...styles.barInner,
                            width: `${percent}%`,
                            ...(isLoading && percent < 100
                                ? { animation: 'pulse 1.5s ease infinite' }
                                : {}),
                        }}
                    />
                </div>

                {logs.length > 0 && (
                    <div style={styles.logContainer}>
                        {logs.map((log, idx) => {
                            const pc = phaseColors[log.phase] || phaseColors.start;
                            return (
                                <div key={idx} style={styles.logItem}>
                                    <span style={styles.logTime}>{log.time}</span>
                                    <span
                                        style={{
                                            ...styles.logPhase,
                                            background: pc.bg,
                                            color: pc.color,
                                        }}
                                    >
                                        {log.phase}
                                    </span>
                                    <span style={styles.logMsg}>{log.message}</span>
                                </div>
                            );
                        })}
                        <div ref={logEndRef} />
                    </div>
                )}
            </div>

            <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
        </div>
    );
}
