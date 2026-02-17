import { useState, useCallback } from 'react';
import { useScraper } from './hooks/useScraper.js';
import PrefectureSelector from './components/PrefectureSelector.jsx';
import ServiceTypeSelector from './components/ServiceTypeSelector.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import ProgressBar from './components/ProgressBar.jsx';
import ExportPanel from './components/ExportPanel.jsx';
import './App.css';

export default function App() {
    const {
        prefectures,
        regions,
        serviceTypes,
        results,
        totalResults,
        isLoading,
        progress,
        logs,
        currentPage,
        totalPages,
        searchQuery,
        setSearchQuery,
        startScraping,
        fetchData,
        exportData,
        clearData,
    } = useScraper();

    const [selectedPrefs, setSelectedPrefs] = useState([]);
    const [selectedServices, setSelectedServices] = useState([]);
    const [method, setMethod] = useState('multi');
    const [sectionOpen, setSectionOpen] = useState({
        prefecture: true,
        service: true,
    });

    const toggleSection = (key) => {
        setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleStart = useCallback(() => {
        if (selectedPrefs.length === 0 || selectedServices.length === 0) {
            return;
        }
        startScraping(selectedPrefs, selectedServices, method);
    }, [selectedPrefs, selectedServices, method, startScraping]);

    const handleSearchChange = useCallback(
        (query) => {
            setSearchQuery(query);
            fetchData(1, query);
        },
        [setSearchQuery, fetchData]
    );

    const canStart =
        selectedPrefs.length > 0 && selectedServices.length > 0 && !isLoading;

    return (
        <div className="app">
            {/* ヘッダー */}
            <header className="header">
                <div className="header-inner">
                    <div className="header-title">
                        <img className="header-icon" src="/scrp.png?v=3" alt="Kaientai-S ロゴ" />
                        <div>
                            <h1>Kaientai-S</h1>
                            <div className="header-subtitle">
                                都道府県別に事業所の名称・住所・FAX番号を一括取得
                            </div>
                        </div>
                    </div>
                    <ExportPanel
                        totalResults={totalResults}
                        onExport={exportData}
                        onClear={clearData}
                    />
                </div>
            </header>

            {/* メインレイアウト */}
            <div className="layout">
                {/* サイドバー */}
                <aside className="sidebar">
                    {/* 取得方式 */}
                    <div className="section">
                        <div className="section-header" style={{ cursor: 'default' }}>
                            <span className="section-title">
                                <span className="section-icon">⚙️</span>
                                取得方式
                            </span>
                        </div>
                        <div className="section-body">
                            <div className="method-selector">
                                <button
                                    className={`method-btn ${method === 'multi' ? 'active' : ''}`}
                                    onClick={() => setMethod('multi')}
                                >
                                    🔗 複数サイト統合
                                    <br />
                                    <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                        推奨・大量取得
                                    </small>
                                </button>
                                <button
                                    className={`method-btn ${method === 'opendata' ? 'active' : ''}`}
                                    onClick={() => setMethod('opendata')}
                                >
                                    📥 公式オープンデータ
                                    <br />
                                    <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                        公式ソースのみ
                                    </small>
                                </button>
                                <button
                                    className={`method-btn ${method === 'web' ? 'active' : ''}`}
                                    onClick={() => setMethod('web')}
                                >
                                    🌐 Webスクレイピング
                                    <br />
                                    <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                        詳細取得
                                    </small>
                                </button>
                            </div>
                            <div className="hint-card">
                                {method === 'multi' ? (
                                    <>
                                        <strong>🔗 複数サイト統合</strong>
                                        <br />
                                        公式オープンデータと data.go.jp を順次取得し、重複排除して統合します。
                                        件数が不足する場合は Web スクレイピングで補完します。
                                    </>
                                ) : method === 'opendata' ? (
                                    <>
                                        <strong>📥 公式オープンデータ方式</strong>
                                        <br />
                                        厚生労働省が公開するCSVファイルからデータを取得します。
                                        安定した取得に向きますが、障害時の代替ソースは使いません。
                                    </>
                                ) : (
                                    <>
                                        <strong>🌐 Webスクレイピング方式</strong>
                                        <br />
                                        介護サービス情報公表システムのWebサイトから直接取得します。
                                        サーバー負荷軽減のため時間がかかります。
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 都道府県選択 */}
                    <div className="section">
                        <div
                            className="section-header"
                            onClick={() => toggleSection('prefecture')}
                        >
                            <span className="section-title">
                                <span className="section-icon">📍</span>
                                都道府県
                            </span>
                            <span
                                className="section-toggle"
                                style={{
                                    transform: sectionOpen.prefecture
                                        ? 'rotate(0)'
                                        : 'rotate(-90deg)',
                                }}
                            >
                                ▼
                            </span>
                        </div>
                        {sectionOpen.prefecture && (
                            <div className="section-body">
                                <PrefectureSelector
                                    prefectures={prefectures}
                                    regions={regions}
                                    selectedPrefectures={selectedPrefs}
                                    onSelectionChange={setSelectedPrefs}
                                />
                            </div>
                        )}
                    </div>

                    {/* サービス種別選択 */}
                    <div className="section">
                        <div
                            className="section-header"
                            onClick={() => toggleSection('service')}
                        >
                            <span className="section-title">
                                <span className="section-icon">🏢</span>
                                サービス種別
                            </span>
                            <span
                                className="section-toggle"
                                style={{
                                    transform: sectionOpen.service
                                        ? 'rotate(0)'
                                        : 'rotate(-90deg)',
                                }}
                            >
                                ▼
                            </span>
                        </div>
                        {sectionOpen.service && (
                            <div className="section-body">
                                <ServiceTypeSelector
                                    serviceTypes={serviceTypes}
                                    selectedServices={selectedServices}
                                    onSelectionChange={setSelectedServices}
                                />
                            </div>
                        )}
                    </div>

                    {/* 実行ボタン */}
                    <button
                        className="start-btn"
                        onClick={handleStart}
                        disabled={!canStart}
                    >
                        {isLoading ? (
                            <>
                                <span className="spinner" />
                                取得中...
                            </>
                        ) : (
                            <>
                                🚀 データ取得開始
                            </>
                        )}
                    </button>
                </aside>

                {/* メインエリア */}
                <main className="main">
                    {/* 進捗表示 */}
                    <ProgressBar
                        progress={progress}
                        logs={logs}
                        isLoading={isLoading}
                    />

                    {/* 結果テーブル */}
                    <ResultsTable
                        results={results}
                        totalResults={totalResults}
                        currentPage={currentPage}
                        totalPages={totalPages}
                        searchQuery={searchQuery}
                        onSearchChange={handleSearchChange}
                        onPageChange={(page) => fetchData(page)}
                    />
                </main>
            </div>
        </div>
    );
}
