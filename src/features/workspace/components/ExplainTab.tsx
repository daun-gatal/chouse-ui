import React, { useState, useCallback, useEffect } from 'react';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
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
              <AlertCircle className="h-4 w-4" />
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

    // Handle explain views
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Generating {EXPLAIN_TYPES[activeView as ExplainType]?.label.toLowerCase() || ''} explain...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      );
    }

    if (!plan) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
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
  const viewTypes: { key: ViewType; label: string; description: string }[] = [
    ...Object.entries(EXPLAIN_TYPES).map(([key, value]) => ({
      key: key as ExplainType,
      label: value.label,
      description: value.description
    })),
    { key: 'analysis', label: 'Analysis', description: 'Query complexity and performance recommendations' }
  ];

  return (
    <div className="h-full flex flex-col">
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

export default ExplainTab;
