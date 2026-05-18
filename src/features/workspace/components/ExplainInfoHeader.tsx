import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp, Lightbulb, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type ExplainViewType = 'plan' | 'ast' | 'syntax' | 'pipeline' | 'estimate' | 'analysis';

interface ExplainInfo {
  title: string;
  description: string;
  howToRead: string[];
  keyInsights: string[];
}

const EXPLAIN_INFO: Record<ExplainViewType, ExplainInfo> = {
  plan: {
    title: 'Execution Plan',
    description: 'Shows how ClickHouse will execute your query step by step. Each node represents an operation, and arrows show data flow direction.',
    howToRead: [
      'Data flows from top to bottom (source → result)',
      'Each node shows the operation type and metrics',
      'Colors indicate operation category (read, filter, aggregate, etc.)',
      'Nodes may show Parts/Granules selected by indexes',
    ],
    keyInsights: [
      'Look for ReadFromMergeTree at the top to see which tables are scanned',
      'Filter nodes early in the plan (higher up) are more efficient',
      'Selected Parts/Granules show how well indexes filter the data',
    ],
  },
  ast: {
    title: 'Abstract Syntax Tree',
    description: 'Shows how your SQL query is parsed into a tree structure. Each node represents a syntactic element of your query.',
    howToRead: [
      'Root node is usually SelectQuery or similar',
      'Child nodes represent query components (tables, columns, conditions)',
      'Tree depth shows query complexity',
      'Leaf nodes are literals, identifiers, or simple expressions',
    ],
    keyInsights: [
      'Deep trees may indicate complex queries that could be simplified',
      'Multiple SelectQuery nodes suggest subqueries',
      'Look for Function nodes to see which functions are called',
    ],
  },
  syntax: {
    title: 'Optimized Query',
    description: 'Shows how ClickHouse rewrites and optimizes your query before execution. Compare with your original query to see transformations.',
    howToRead: [
      'This is the actual query that will be executed',
      'Keywords are color-coded by type (clauses, functions, etc.)',
      'ClickHouse may add or remove columns, reorder operations',
      'Implicit type casts and defaults become explicit',
    ],
    keyInsights: [
      'Check if your WHERE conditions are preserved correctly',
      'Look for added PREWHERE for early filtering optimization',
      'Verify JOIN order matches your expectations',
    ],
  },
  pipeline: {
    title: 'Processing Pipeline',
    description: 'Shows the data processing pipeline with parallel execution stages. This represents how data flows through ClickHouse\'s query processor.',
    howToRead: [
      'Data flows left to right through processing stages',
      'Emerald borders indicate parallel execution (multi-threaded)',
      'The ×N badge shows parallelism level (number of threads)',
      'Resize stages adjust parallelism between operations',
    ],
    keyInsights: [
      'More parallel stages = better utilization of CPU cores',
      'Look for bottlenecks where parallelism drops to 1',
      'MergeTree stages show direct table reads',
    ],
  },
  estimate: {
    title: 'Cost Estimation',
    description: 'Shows estimated resource usage before running the query. Helps predict query cost without executing it.',
    howToRead: [
      'Rows: Estimated number of rows to read from disk',
      'Parts: Number of data parts (files) to access',
      'Marks: Index marks to scan (ClickHouse uses mark-based indexing)',
      'Totals show aggregate across all tables',
    ],
    keyInsights: [
      'High row counts may indicate inefficient filtering',
      'Many parts suggest fragmented data (consider OPTIMIZE)',
      'Compare estimates with actual statistics after execution',
    ],
  },
  analysis: {
    title: 'Query Analysis',
    description: 'Analyzes your query structure and provides performance recommendations based on best practices.',
    howToRead: [
      'Complexity score rates query from 0-100 (lower is simpler)',
      'Metrics show query characteristics (joins, aggregations, etc.)',
      'Recommendations are sorted by severity (critical → warning → info)',
      'Suggestions provide actionable improvements',
    ],
    keyInsights: [
      'Fix critical issues first for best performance gains',
      'SELECT * and missing LIMIT are common issues',
      'PREWHERE can significantly speed up filtered queries',
    ],
  },
};

interface ExplainInfoHeaderProps {
  type: ExplainViewType;
  defaultExpanded?: boolean;
  className?: string;
}

const ExplainInfoHeader: React.FC<ExplainInfoHeaderProps> = ({
  type,
  defaultExpanded = false,
  className,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const info = EXPLAIN_INFO[type];

  return (
    <div className={cn("border-b border-ink-500 bg-ink-100", className)}>
      {/* Collapsed Header */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-left transition-colors hover:bg-ink-200"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <HelpCircle className="h-3 w-3" aria-hidden />
          </span>
          <span className="text-[13px] font-medium text-paper">{info.title}</span>
          <span className="text-[11px] text-paper-faint">— {info.description.split('.')[0]}</span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-paper-dim hover:bg-ink-200 hover:text-paper">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="space-y-3 border-t border-ink-500 px-4 pb-3 pt-3">
          {/* Description */}
          <p className="text-[12px] text-paper-muted">{info.description}</p>

          <div className="grid grid-cols-2 gap-4">
            {/* How to Read */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                <Info className="h-3 w-3" aria-hidden />
                How to read
              </div>
              <ul className="space-y-1">
                {info.howToRead.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-paper-muted">
                    <span className="mt-0.5 text-paper-faint">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Key Insights */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                <Lightbulb className="h-3 w-3 text-brand" aria-hidden />
                Key insights
              </div>
              <ul className="space-y-1">
                {info.keyInsights.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-paper-muted">
                    <span className="mt-0.5 text-brand">→</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExplainInfoHeader;
