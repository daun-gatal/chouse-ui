import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertCircle, Sparkles } from 'lucide-react';
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
            <div className="flex items-center justify-center h-full text-muted-foreground">
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
        <div className="h-full flex flex-col">
            <ExplainInfoHeader type="estimate" />
            <div className="flex-1 overflow-auto p-4 space-y-4">
                {/* Summary Card */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-zinc-300 mb-3">Cost Estimation Summary</h3>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-blue-400">{formatNumber(totals.rows)}</div>
                            <div className="text-xs text-zinc-500">Estimated Rows</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-purple-400">{formatNumber(totals.parts)}</div>
                            <div className="text-xs text-zinc-500">Parts to Read</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-green-400">{formatNumber(totals.marks)}</div>
                            <div className="text-xs text-zinc-500">Marks to Read</div>
                        </div>
                    </div>
                </div>

                {/* Per-table breakdown */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-800">
                        <h3 className="text-sm font-semibold text-zinc-300">Table Breakdown</h3>
                    </div>
                    <table className="w-full text-xs">
                        <thead className="bg-zinc-800/50">
                            <tr>
                                <th className="px-4 py-2 text-left text-zinc-400 font-medium">Database</th>
                                <th className="px-4 py-2 text-left text-zinc-400 font-medium">Table</th>
                                <th className="px-4 py-2 text-right text-zinc-400 font-medium">Rows</th>
                                <th className="px-4 py-2 text-right text-zinc-400 font-medium">Parts</th>
                                <th className="px-4 py-2 text-right text-zinc-400 font-medium">Marks</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((row, i) => (
                                <tr key={i} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
                                    <td className="px-4 py-2 text-zinc-300">{row.database}</td>
                                    <td className="px-4 py-2 text-zinc-300 font-mono">{row.table}</td>
                                    <td className="px-4 py-2 text-right text-blue-400">{formatNumber(Number(row.rows) || 0)}</td>
                                    <td className="px-4 py-2 text-right text-purple-400">{formatNumber(Number(row.parts) || 0)}</td>
                                    <td className="px-4 py-2 text-right text-green-400">{formatNumber(Number(row.marks) || 0)}</td>
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
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        No query available for analysis.
                    </div>
                );
            }

            if (analysisLoading) {
                return (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span>Analyzing query...</span>
                    </div>
                );
            }

            if (analysisError) {
                return (
                    <div className="p-4">
                        <Alert variant="destructive">
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{analysisError}</AlertDescription>
                        </Alert>
                    </div>
                );
            }

            if (!analysisData) {
                return (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        No analysis data available.
                    </div>
                );
            }

            return (
                <div className="h-full flex flex-col">
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
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span>Loading {EXPLAIN_TYPES[activeView as ExplainType]?.label.toLowerCase() || ''} explain...</span>
                </div>
            );
        }

        // Show error state
        if (loadError) {
            return (
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{loadError}</AlertDescription>
                    </Alert>
                </div>
            );
        }

        // Get cached result for current view
        const currentResult = explainCache[activeView as ExplainType];

        if (!currentResult) {
            return (
                <div className="flex items-center justify-center h-full text-muted-foreground">
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
            <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a] text-white">
                <div className="text-center p-8 border border-white/10 rounded-lg bg-white/5 backdrop-blur-sm">
                    <h1 className="text-xl font-bold mb-2">Error</h1>
                    <p className="text-muted-foreground">{error}</p>
                </div>
            </div>
        );
    }

    // Show loading if we don't have any cached data yet
    if (Object.keys(explainCache).length === 0) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a] text-white">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span>Loading explain data...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen bg-[#0a0a0a] text-white overflow-hidden flex flex-col">
            {/* Type Selector */}
            <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/30 px-2">
                <Tabs value={activeView} onValueChange={handleViewChange}>
                    <TabsList className="bg-transparent h-9 gap-1">
                        {viewTypes.map(({ key, label, description }) => (
                            <TabsTrigger
                                key={key}
                                value={key}
                                className={cn(
                                    "text-xs px-3 py-1.5 rounded-md transition-colors",
                                    "data-[state=active]:bg-zinc-800 data-[state=active]:text-white",
                                    "data-[state=inactive]:text-zinc-500 hover:text-zinc-300",
                                    key === 'analysis' && "flex items-center gap-1.5"
                                )}
                                title={description}
                            >
                                {key === 'analysis' && <Sparkles className="h-3 w-3" />}
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
