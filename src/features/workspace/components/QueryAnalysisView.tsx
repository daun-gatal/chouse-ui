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

// Severity → editorial chip recipe. Emerald = low (good), amber = medium,
// red = high (worst). The bar variant is the solid color used to fill the
// progress bar; the chip variants follow the destructive/warning/active
// recipe pattern used elsewhere (border-X-900/60 + bg-X-950/40 + text-X-300).
const COMPLEXITY_COLORS: Record<ComplexityLevel, { chip: string; text: string; bar: string }> = {
  low: {
    chip: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
    text: 'text-emerald-300',
    bar: 'bg-emerald-500',
  },
  medium: {
    chip: 'border-amber-900/60 bg-amber-950/40 text-amber-300',
    text: 'text-amber-300',
    bar: 'bg-amber-500',
  },
  high: {
    chip: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300',
    text: 'text-red-300',
    bar: 'bg-red-500',
  },
};

export const ComplexityCard: React.FC<ComplexityCardProps> = ({ complexity }) => {
  const colors = COMPLEXITY_COLORS[complexity.level];
  const { metrics } = complexity;

  return (
    <div className="rounded-xs border border-ink-500 bg-ink-100 p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className={cn("h-4 w-4", colors.text)} aria-hidden />
          <h3 className="text-[14px] font-semibold tracking-tight text-paper">Query complexity</h3>
        </div>
        <span className={cn("inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]", colors.chip)}>
          {complexity.level}
        </span>
      </div>

      {/* Score Bar */}
      <div className="mb-4">
        <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
          <span className="text-paper-dim">Complexity score</span>
          <span className={cn("tabular-nums", colors.text)}>{complexity.score}/100</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-xs bg-ink-200">
          <div
            className={cn("h-full transition-all", colors.bar)}
            style={{ width: `${complexity.score}%` }}
          />
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricItem icon={Table} label="Tables" value={metrics.tableCount} />
        <MetricItem icon={GitBranch} label="Joins" value={metrics.joinCount} />
        <MetricItem icon={Layers} label="Subquery depth" value={metrics.subqueryDepth} />
        <MetricItem icon={Calculator} label="Aggregations" value={metrics.aggregationCount} />
        <MetricItem icon={Columns} label="Columns" value={metrics.isSelectStar ? 'All (*)' : metrics.columnCount} />
        <MetricItem icon={Hash} label="DISTINCT" value={metrics.hasDistinct ? 'Yes' : 'No'} highlight={metrics.hasDistinct} />
        <MetricItem icon={Filter} label="GROUP BY" value={metrics.hasGroupBy ? 'Yes' : 'No'} highlight={metrics.hasGroupBy} />
        <MetricItem icon={ArrowUpDown} label="ORDER BY" value={metrics.hasOrderBy ? 'Yes' : 'No'} highlight={metrics.hasOrderBy} />
      </div>

      {/* Additional Info */}
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-500 pt-3">
        {metrics.hasLimit && (
          <span className="inline-flex items-center rounded-xs border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">LIMIT ✓</span>
        )}
        {metrics.hasWhere && (
          <span className="inline-flex items-center rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">WHERE ✓</span>
        )}
        {metrics.hasPrewhere && (
          <span className="inline-flex items-center rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">PREWHERE ✓</span>
        )}
        {!metrics.hasLimit && (
          <span className="inline-flex items-center rounded-xs border border-amber-900/60 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">No LIMIT</span>
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
  <div className="flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 p-2">
    <Icon className={cn("h-3.5 w-3.5 shrink-0", highlight ? "text-brand" : "text-paper-dim")} />
    <div className="flex min-w-0 flex-col">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{label}</span>
      <span className={cn("text-[12px] font-medium tabular-nums", highlight ? "text-brand" : "text-paper")}>{value}</span>
    </div>
  </div>
);

// ============================================
// Recommendations Card Component
// ============================================

interface RecommendationsCardProps {
  recommendations: PerformanceRecommendation[];
}

// Severity → editorial chip recipe. Critical = red, warning = amber, info = neutral hairline.
const SEVERITY_CONFIG: Record<RecommendationSeverity, { icon: React.FC<{ className?: string }>; chip: string; text: string }> = {
  info:     { icon: Info,          chip: 'border-ink-500 bg-ink-200 text-paper-muted', text: 'text-paper-muted' },
  warning:  { icon: AlertTriangle, chip: 'border-amber-900/60 bg-amber-950/40 text-amber-300', text: 'text-amber-300' },
  critical: { icon: AlertCircle,   chip: 'border-red-300 bg-red-50 text-red-300', text: 'text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300' },
};

export const RecommendationsCard: React.FC<RecommendationsCardProps> = ({ recommendations }) => {
  if (recommendations.length === 0) {
    return (
      <div className="rounded-xs border border-emerald-900/60 bg-emerald-950/30 p-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-emerald-300" aria-hidden />
          <h3 className="text-[14px] font-semibold tracking-tight text-paper">No issues found</h3>
        </div>
        <p className="mt-2 text-[12px] text-paper-muted">
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
    <div className="rounded-xs border border-ink-500 bg-ink-100 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-paper-dim" aria-hidden />
          <h3 className="text-[14px] font-semibold tracking-tight text-paper">Performance recommendations</h3>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
          {recommendations.length} suggestion{recommendations.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-2">
        {sortedRecommendations.map((rec) => {
          const config = SEVERITY_CONFIG[rec.severity];
          const Icon = config.icon;

          return (
            <div key={rec.id} className={cn("rounded-xs border p-3", config.chip.replace(/text-[a-z]+-\d+/, ''))}>
              <div className="flex items-start gap-3">
                <Icon className={cn("mt-0.5 h-3.5 w-3.5 flex-shrink-0", config.text)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className={cn("text-[13px] font-medium", config.text)}>{rec.title}</h4>
                    <span className={cn("inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]", config.chip)}>
                      {rec.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-paper-muted">{rec.description}</p>
                  {rec.suggestion && (
                    <p className="mt-2 rounded-xs border border-ink-500 bg-ink-200 p-2 text-[12px] text-paper-muted">
                      <span className="mr-1 text-brand">→</span>
                      {rec.suggestion}
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
    <div className="h-full space-y-4 overflow-auto p-4">
      <ComplexityCard complexity={complexity} />
      <RecommendationsCard recommendations={recommendations} />
    </div>
  );
};

export default QueryAnalysisView;
