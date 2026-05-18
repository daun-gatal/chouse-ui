import React, { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import VisualExplain from "@/features/workspace/components/VisualExplain";
import ASTView from "@/features/workspace/components/ASTView";
import SyntaxView from "@/features/workspace/components/SyntaxView";
import PipelineView from "@/features/workspace/components/PipelineView";
import QueryAnalysisView from "@/features/workspace/components/QueryAnalysisView";
import ExplainInfoHeader from "@/features/workspace/components/ExplainInfoHeader";
import { ExplainResult, ExplainType, EXPLAIN_TYPES, QueryComplexity, PerformanceRecommendation } from '@/types/explain';
import { queryApi } from '@/api';
import { useConfig } from '@/hooks';
import { log } from '@/lib/log';

// Extended type to include analysis
type ViewType = ExplainType | 'analysis';

// Cache for explain results by type
interface ExplainCache {
    plan?: ExplainResult;
    ast?: ExplainResult;
    syntax?: ExplainResult;
    pipeline?: ExplainResult;
    estimate?: ExplainResult;
}

/**
 * Estimate display component for EXPLAIN ESTIMATE
 */
const EstimateView: React.FC<{ data: any[] | null | undefined }> = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
                No estimate data available.
            </div>
        );
    }

    // Calculate totals
    const totals = data.reduce(
        (acc, row) => ({
            rows: acc.rows + (Number(row.rows) || 0),
            parts: acc.parts + (Number(row.parts) || 0),
            marks: acc.marks + (Number(row.marks) || 0),
        }),
        { rows: 0, parts: 0, marks: 0 }
    );

    const formatNumber = (n: number) => n.toLocaleString();

    return (
        <div className="flex h-full flex-col">
            <ExplainInfoHeader type="estimate" />
            <div className="flex-1 space-y-4 overflow-auto p-4">
                {/* Summary Card */}
                <div className="rounded-xs border border-ink-500 bg-ink-100 p-4">
                    <span className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                        <span className="h-px w-6 bg-ink-700" />
                        <span>Cost estimation summary</span>
                    </span>
                    <div className="mt-2 grid grid-cols-3 border-l border-t border-ink-500">
                        <div className="border-b border-r border-ink-500 p-4 text-center">
                            <div className="font-mono text-[22px] font-semibold tabular-nums text-paper">{formatNumber(totals.rows)}</div>
                            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Estimated rows</div>
                        </div>
                        <div className="border-b border-r border-ink-500 p-4 text-center">
                            <div className="font-mono text-[22px] font-semibold tabular-nums text-paper">{formatNumber(totals.parts)}</div>
                            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Parts to read</div>
                        </div>
                        <div className="border-b border-r border-ink-500 p-4 text-center">
                            <div className="font-mono text-[22px] font-semibold tabular-nums text-paper">{formatNumber(totals.marks)}</div>
                            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Marks to read</div>
                        </div>
                    </div>
                </div>

                {/* Per-table breakdown */}
                <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
                    <div className="border-b border-ink-500 px-4 py-3">
                        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                            <span className="h-px w-6 bg-ink-700" />
                            <span>Table breakdown</span>
                        </span>
                    </div>
                    <table className="w-full text-[12px]">
                        <thead className="bg-ink-200">
                            <tr>
                                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Database</th>
                                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Table</th>
                                <th className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Rows</th>
                                <th className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Parts</th>
                                <th className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Marks</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((row, i) => (
                                <tr key={i} className="border-t border-ink-500 hover:bg-ink-200">
                                    <td className="px-4 py-2 text-paper-muted">{row.database}</td>
                                    <td className="px-4 py-2 font-mono text-paper">{row.table}</td>
                                    <td className="px-4 py-2 text-right font-mono tabular-nums text-paper">{formatNumber(Number(row.rows) || 0)}</td>
                                    <td className="px-4 py-2 text-right font-mono tabular-nums text-paper">{formatNumber(Number(row.parts) || 0)}</td>
                                    <td className="px-4 py-2 text-right font-mono tabular-nums text-paper">{formatNumber(Number(row.marks) || 0)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const ExplainPopout = () => {
    const [query, setQuery] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [activeView, setActiveView] = useState<ViewType>('plan');
    const [initialType, setInitialType] = useState<ExplainType>('plan');

    // Cache for explain results
    const [explainCache, setExplainCache] = useState<ExplainCache>({});
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Analysis state
    const [analysisData, setAnalysisData] = useState<{ complexity: QueryComplexity; recommendations: PerformanceRecommendation[] } | null>(null);
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [analysisError, setAnalysisError] = useState<string | null>(null);

    const { data: config, isLoading: configLoading } = useConfig();
    const showAnalysisTab = !config?.features?.aiOptimizer;

    // Load initial data from localStorage
    useEffect(() => {
        try {
            const storedData = localStorage.getItem('explain_popout_data');
            if (storedData) {
                const parsed = JSON.parse(storedData);

                // Handle both old format (just plan) and new format (explainResult + query)
                if (parsed.explainResult) {
                    const result = parsed.explainResult as ExplainResult;
                    const type = result.type || 'plan';
                    setQuery(parsed.query || result.query || '');
                    setInitialType(type);
                    setActiveView(type);
                    // Cache the initial result
                    setExplainCache({ [type]: result });
                } else if (parsed.type) {
                    // ExplainResult directly
                    const type = parsed.type || 'plan';
                    setQuery(parsed.query || '');
                    setInitialType(type);
                    setActiveView(type);
                    setExplainCache({ [type]: parsed });
                } else {
                    setInitialType('plan');
                    setActiveView('plan');
                    setExplainCache({ plan: { type: 'plan', query: '', plan: parsed } });
                }

                // If currently set to analysis but it's disabled, switch to plan
                if (activeView === 'analysis' && !showAnalysisTab && !configLoading) {
                    setActiveView('plan');
                }

                document.title = "Query Explain - ClickHouse";
            } else {
                setError("No explain data found. Please run an EXPLAIN query in the main window first.");
            }
        } catch (err) {
            setError("Failed to parse explain data.");
            log.error('Failed to parse explain data', err);
        }
    }, []);

    // Fetch explain data when switching to a new type
    useEffect(() => {
        const fetchExplainData = async () => {
            // Skip if it's analysis view (handled separately)
            if (activeView === 'analysis') return;

            // Skip if we already have data for this type
            if (explainCache[activeView as ExplainType]) return;

            // Skip if no query available
            if (!query) return;

            setIsLoading(true);
            setLoadError(null);

            try {
                const result = await queryApi.explainQuery(query, activeView as ExplainType);
                setExplainCache(prev => ({
                    ...prev,
                    [activeView]: result
                }));
            } catch (err: any) {
                log.error(`Error fetching ${activeView} explain`, err);
                setLoadError(err.message || `Failed to fetch ${activeView} explain`);
            } finally {
                setIsLoading(false);
            }
        };

        fetchExplainData();
    }, [activeView, query, explainCache]);

    // Fetch analysis when the analysis tab is selected
    useEffect(() => {
        if (activeView === 'analysis' && query && !analysisData && !analysisLoading) {
            setAnalysisLoading(true);
            setAnalysisError(null);

            queryApi.analyzeQuery(query)
                .then((result) => {
                    setAnalysisData(result);
                })
                .catch((err) => {
                    setAnalysisError(err.message || 'Failed to analyze query');
                })
                .finally(() => {
                    setAnalysisLoading(false);
                });
        }
    }, [activeView, query, analysisData, analysisLoading]);

    const handleViewChange = useCallback((view: string) => {
        setActiveView(view as ViewType);
        setLoadError(null);
    }, []);

    // Render content based on current view
    const renderContent = () => {
        // Handle analysis view
        if (activeView === 'analysis') {
            if (!query) {
                return (
                    <div className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
                        No query available for analysis.
                    </div>
                );
            }

            if (analysisLoading) {
                return (
                    <div className="flex h-full flex-col items-center justify-center gap-3">
                        <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
                        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">Analyzing query…</span>
                    </div>
                );
            }

            if (analysisError) {
                return (
                    <div className="p-4">
                        <Alert variant="destructive" className="rounded-xs border-red-900/60 bg-red-950/40 text-red-200">
                            <AlertTitle className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">Error</AlertTitle>
                            <AlertDescription>{analysisError}</AlertDescription>
                        </Alert>
                    </div>
                );
            }

            if (!analysisData) {
                return (
                    <div className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
                        No analysis data available.
                    </div>
                );
            }

            return (
                <div className="flex h-full flex-col">
                    <ExplainInfoHeader type="analysis" />
                    <div className="flex-1 overflow-hidden">
                        <QueryAnalysisView complexity={analysisData.complexity} recommendations={analysisData.recommendations} />
                    </div>
                </div>
            );
        }

        // Show loading state
        if (isLoading) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
                        Loading {EXPLAIN_TYPES[activeView as ExplainType]?.label.toLowerCase() || ''} explain…
                    </span>
                </div>
            );
        }

        // Show error state
        if (loadError) {
            return (
                <div className="p-4">
                    <Alert variant="destructive" className="rounded-xs border-red-900/60 bg-red-950/40 text-red-200">
                        <AlertTitle className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">Error</AlertTitle>
                        <AlertDescription>{loadError}</AlertDescription>
                    </Alert>
                </div>
            );
        }

        // Get cached result for current view
        const currentResult = explainCache[activeView as ExplainType];

        if (!currentResult) {
            return (
                <div className="flex h-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
                    No data available for this view.
                </div>
            );
        }

        // Render based on view type
        switch (activeView) {
            case 'plan':
                return (
                    <div className="w-full h-full">
                        <VisualExplain plan={currentResult} />
                    </div>
                );
            case 'ast':
                return <ASTView content={currentResult.ast} />;
            case 'syntax':
                return <SyntaxView content={currentResult.syntax} />;
            case 'pipeline':
                return <PipelineView content={currentResult.pipeline} />;
            case 'estimate':
                return <EstimateView data={currentResult.estimate} />;
            default:
                return (
                    <div className="w-full h-full">
                        <VisualExplain plan={currentResult} />
                    </div>
                );
        }
    };

    // All view types including analysis
    const viewTypes: { key: ViewType; label: string; description: string }[] = [
        ...Object.entries(EXPLAIN_TYPES).map(([key, value]) => ({
            key: key as ExplainType,
            label: value.label,
            description: value.description
        })),
        ...(showAnalysisTab ? [{ key: 'analysis' as ViewType, label: 'Analysis', description: 'Query complexity and performance recommendations' }] : [])
    ];

    if (error) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-ink-50 text-paper">
                <div className="rounded-xs border border-ink-500 bg-ink-100 p-8 text-center">
                    <h1 className="mb-2 text-[18px] font-semibold tracking-tight text-paper">Error</h1>
                    <p className="text-[12px] text-paper-muted">{error}</p>
                </div>
            </div>
        );
    }

    // Show loading if we don't have any cached data yet
    if (Object.keys(explainCache).length === 0) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-ink-50">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">Loading explain data…</span>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-50 text-paper">
            {/* Type Selector */}
            <div className="flex-shrink-0 border-b border-ink-500 bg-ink-100 px-2">
                <Tabs value={activeView} onValueChange={handleViewChange}>
                    <TabsList className="h-9 gap-0.5 bg-transparent">
                        {viewTypes.map(({ key, label, description }) => (
                            <TabsTrigger
                                key={key}
                                value={key}
                                className={cn(
                                    "rounded-xs px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                                    "data-[state=active]:bg-ink-200 data-[state=active]:text-paper",
                                    "data-[state=inactive]:text-paper-dim hover:text-paper"
                                )}
                                title={description}
                            >
                                {label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
                {renderContent()}
            </div>
        </div>
    );
};

export default ExplainPopout;
