import React, { useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import VisualExplain from './VisualExplain';
import QueryAnalysisView from './QueryAnalysisView';
import ASTView from './ASTView';
import SyntaxView from './SyntaxView';
import PipelineView from './PipelineView';
import ExplainInfoHeader from './ExplainInfoHeader';
import { ExplainResult, ExplainEstimate, ExplainType, EXPLAIN_TYPES, QueryComplexity, PerformanceRecommendation } from '@/types/explain';
import { queryApi } from '@/api';
import { useConfig } from '@/hooks';

// Extended type to include analysis
type ViewType = ExplainType | 'analysis';

interface ExplainTabProps {
  plan: ExplainResult | null;
  error?: string | null;
  isLoading?: boolean;
  onTypeChange?: (type: ExplainType) => void;
  currentType?: ExplainType;
  query?: string; // The original query for analysis
  refreshKey?: number; // Incremented when explain is clicked to force refresh
}

/**
 * Estimate display component for EXPLAIN ESTIMATE
 */
const EstimateView: React.FC<{ data: ExplainEstimate[] | null | undefined }> = ({ data }) => {
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
    <div className="h-full flex flex-col">
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

const ExplainTab: React.FC<ExplainTabProps> = ({
  plan,
  error,
  isLoading,
  onTypeChange,
  currentType = 'plan',
  query,
  refreshKey = 0
}) => {
  const [activeView, setActiveView] = useState<ViewType>(currentType);

  // Analysis state
  const [analysisData, setAnalysisData] = useState<{ complexity: QueryComplexity; recommendations: PerformanceRecommendation[] } | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Track the last refresh key to detect when a new explain is requested
  const [lastRefreshKey, setLastRefreshKey] = useState<number>(refreshKey);

  const { data: config } = useConfig();
  const showAnalysisTab = !config?.features?.aiOptimizer;

  // Sync activeView with currentType when it changes from parent
  useEffect(() => {
    setActiveView(currentType);
  }, [currentType]);

  // Reset analysis data when refreshKey changes (new explain requested)
  useEffect(() => {
    if (refreshKey !== lastRefreshKey) {
      setLastRefreshKey(refreshKey);
      setAnalysisData(null);
      setAnalysisError(null);
      setAnalysisLoading(false);
    }
  }, [refreshKey, lastRefreshKey]);

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
    const viewType = view as ViewType;
    setActiveView(viewType);

    // Only call onTypeChange for explain types, not analysis
    if (viewType !== 'analysis') {
      onTypeChange?.(viewType as ExplainType);
    }
  }, [onTypeChange]);

  // Render content based on current view
  const renderContent = () => {
    // Handle analysis view
    if (activeView === 'analysis') {
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

    // Handle explain views
    if (isLoading) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
            Generating {EXPLAIN_TYPES[activeView as ExplainType]?.label.toLowerCase() || ''} explain…
          </span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-4">
          <Alert variant="destructive" className="rounded-xs border-red-900/60 bg-red-950/40 text-red-200">
            <AlertTitle className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      );
    }

    if (!plan) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
          No explain data available. Run "Explain" to visualize the query.
        </div>
      );
    }

    // Render based on plan type
    const planType = plan.type || activeView;

    switch (planType) {
      case 'plan':
        return (
          <div className="w-full h-full">
            <VisualExplain plan={plan} />
          </div>
        );
      case 'ast':
        return <ASTView content={plan.ast} />;
      case 'syntax':
        return <SyntaxView content={plan.syntax} />;
      case 'pipeline':
        return <PipelineView content={plan.pipeline} />;
      case 'estimate':
        return <EstimateView data={plan.estimate} />;
      default:
        // Fallback for legacy plan format (without type field)
        return (
          <div className="w-full h-full">
            <VisualExplain plan={plan} />
          </div>
        );
    }
  };

  // All view types including analysis
  // All view types including analysis
  const viewTypes: { key: ViewType; label: string; description: string }[] = [
    ...Object.entries(EXPLAIN_TYPES).map(([key, value]) => ({
      key: key as ExplainType,
      label: value.label,
      description: value.description
    })),
    ...(showAnalysisTab ? [{ key: 'analysis' as ViewType, label: 'Analysis', description: 'Query complexity and performance recommendations' }] : [])
  ];

  return (
    <div className="flex h-full flex-col">
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

export default ExplainTab;
