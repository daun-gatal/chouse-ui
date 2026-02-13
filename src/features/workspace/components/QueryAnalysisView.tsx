import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Gauge,
  Table,
  GitBranch,
  Layers,
  Calculator,
  Hash,
  Columns,
  Filter,
  ArrowUpDown,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  QueryComplexity,
  PerformanceRecommendation,
  ComplexityLevel,
  RecommendationSeverity
} from '@/types/explain';

// ============================================
// Complexity Card Component
// ============================================

interface ComplexityCardProps {
  complexity: QueryComplexity;
}

const COMPLEXITY_COLORS: Record<ComplexityLevel, { bg: string; text: string; border: string }> = {
  low: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30' },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  high: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' }
};

export const ComplexityCard: React.FC<ComplexityCardProps> = ({ complexity }) => {
  const colors = COMPLEXITY_COLORS[complexity.level];
  const { metrics } = complexity;

  return (
    <div className={cn("rounded-lg border p-4", colors.border, colors.bg)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Gauge className={cn("h-5 w-5", colors.text)} />
          <h3 className="font-semibold text-zinc-200">Query Complexity</h3>
        </div>
        <div className={cn("px-3 py-1 rounded-full text-sm font-medium capitalize", colors.bg, colors.text, "border", colors.border)}>
          {complexity.level}
        </div>
      </div>

      {/* Score Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-zinc-500 mb-1">
          <span>Complexity Score</span>
          <span className={colors.text}>{complexity.score}/100</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", colors.text.replace('text-', 'bg-'))}
            style={{ width: `${complexity.score}%` }}
          />
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricItem icon={Table} label="Tables" value={metrics.tableCount} />
        <MetricItem icon={GitBranch} label="Joins" value={metrics.joinCount} />
        <MetricItem icon={Layers} label="Subquery Depth" value={metrics.subqueryDepth} />
        <MetricItem icon={Calculator} label="Aggregations" value={metrics.aggregationCount} />
        <MetricItem icon={Columns} label="Columns" value={metrics.isSelectStar ? 'All (*)' : metrics.columnCount} />
        <MetricItem icon={Hash} label="DISTINCT" value={metrics.hasDistinct ? 'Yes' : 'No'} highlight={metrics.hasDistinct} />
        <MetricItem icon={Filter} label="GROUP BY" value={metrics.hasGroupBy ? 'Yes' : 'No'} highlight={metrics.hasGroupBy} />
        <MetricItem icon={ArrowUpDown} label="ORDER BY" value={metrics.hasOrderBy ? 'Yes' : 'No'} highlight={metrics.hasOrderBy} />
      </div>

      {/* Additional Info */}
      <div className="mt-3 pt-3 border-t border-zinc-800 flex flex-wrap gap-2 text-xs">
        {metrics.hasLimit && (
          <span className="px-2 py-1 bg-green-500/10 text-green-400 rounded border border-green-500/20">LIMIT ✓</span>
        )}
        {metrics.hasWhere && (
          <span className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">WHERE ✓</span>
        )}
        {metrics.hasPrewhere && (
          <span className="px-2 py-1 bg-purple-500/10 text-purple-400 rounded border border-purple-500/20">PREWHERE ✓</span>
        )}
        {!metrics.hasLimit && (
          <span className="px-2 py-1 bg-yellow-500/10 text-yellow-400 rounded border border-yellow-500/20">No LIMIT</span>
        )}
      </div>
    </div>
  );
};

interface MetricItemProps {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: string | number;
  highlight?: boolean;
}

const MetricItem: React.FC<MetricItemProps> = ({ icon: Icon, label, value, highlight }) => (
  <div className="flex items-center gap-2 bg-zinc-900/50 rounded p-2">
    <Icon className={cn("h-4 w-4", highlight ? "text-yellow-400" : "text-zinc-500")} />
    <div className="flex flex-col">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span className={cn("text-xs font-medium", highlight ? "text-yellow-400" : "text-zinc-300")}>{value}</span>
    </div>
  </div>
);

// ============================================
// Recommendations Card Component
// ============================================

interface RecommendationsCardProps {
  recommendations: PerformanceRecommendation[];
}

const SEVERITY_CONFIG: Record<RecommendationSeverity, { icon: React.FC<{ className?: string }>; colors: { bg: string; text: string; border: string } }> = {
  info: { icon: Info, colors: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' } },
  warning: { icon: AlertTriangle, colors: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30' } },
  critical: { icon: AlertCircle, colors: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' } }
};

export const RecommendationsCard: React.FC<RecommendationsCardProps> = ({ recommendations }) => {
  if (recommendations.length === 0) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-green-400" />
          <h3 className="font-semibold text-zinc-200">No Issues Found</h3>
        </div>
        <p className="text-sm text-zinc-400 mt-2">
          The query looks optimized. No performance recommendations at this time.
        </p>
      </div>
    );
  }

  // Sort by severity: critical > warning > info
  const sortedRecommendations = [...recommendations].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-400" />
          <h3 className="font-semibold text-zinc-200">Performance Recommendations</h3>
        </div>
        <span className="text-xs text-zinc-500">{recommendations.length} suggestion{recommendations.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="space-y-3">
        {sortedRecommendations.map((rec) => {
          const config = SEVERITY_CONFIG[rec.severity];
          const Icon = config.icon;

          return (
            <div key={rec.id} className={cn("rounded-lg border p-3", config.colors.border, config.colors.bg)}>
              <div className="flex items-start gap-3">
                <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", config.colors.text)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className={cn("text-sm font-medium", config.colors.text)}>{rec.title}</h4>
                    <span className={cn("text-[10px] uppercase px-1.5 py-0.5 rounded", config.colors.bg, config.colors.text, "border", config.colors.border)}>
                      {rec.severity}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">{rec.description}</p>
                  {rec.suggestion && (
                    <p className="text-xs text-zinc-300 mt-2 bg-black/20 rounded p-2 border border-white/5">
                      💡 {rec.suggestion}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// Combined Analysis View
// ============================================

interface QueryAnalysisViewProps {
  complexity: QueryComplexity;
  recommendations: PerformanceRecommendation[];
}

export const QueryAnalysisView: React.FC<QueryAnalysisViewProps> = ({ complexity, recommendations }) => {
  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <ComplexityCard complexity={complexity} />
      <RecommendationsCard recommendations={recommendations} />
    </div>
  );
};

export default QueryAnalysisView;
