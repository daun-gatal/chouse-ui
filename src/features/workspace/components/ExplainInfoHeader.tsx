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
  color: string;
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
    color: '#3b82f6',
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
    color: '#8b5cf6',
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
    color: '#a855f7',
  },
  pipeline: {
    title: 'Processing Pipeline',
    description: 'Shows the data processing pipeline with parallel execution stages. This represents how data flows through ClickHouse\'s query processor.',
    howToRead: [
      'Data flows left to right through processing stages',
      'Green borders indicate parallel execution (multi-threaded)',
      'The ×N badge shows parallelism level (number of threads)',
      'Resize stages adjust parallelism between operations',
    ],
    keyInsights: [
      'More parallel stages = better utilization of CPU cores',
      'Look for bottlenecks where parallelism drops to 1',
      'MergeTree stages show direct table reads',
    ],
    color: '#22c55e',
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
    color: '#f59e0b',
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
    color: '#ec4899',
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
    <div className={cn("border-b border-zinc-800 bg-zinc-900/50", className)}>
      {/* Collapsed Header */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-zinc-800/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <div
            className="p-1 rounded"
            style={{ backgroundColor: `${info.color}20` }}
          >
            <HelpCircle className="h-3.5 w-3.5" style={{ color: info.color }} />
          </div>
          <span className="text-sm font-medium text-zinc-300">{info.title}</span>
          <span className="text-xs text-zinc-500">— {info.description.split('.')[0]}</span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          )}
        </Button>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-zinc-800/50 pt-3">
          {/* Description */}
          <p className="text-xs text-zinc-400">{info.description}</p>

          <div className="grid grid-cols-2 gap-4">
            {/* How to Read */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                <Info className="h-3 w-3" style={{ color: info.color }} />
                How to Read
              </div>
              <ul className="space-y-1">
                {info.howToRead.map((item, i) => (
                  <li key={i} className="text-[11px] text-zinc-500 flex items-start gap-1.5">
                    <span className="text-zinc-600 mt-0.5">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Key Insights */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                <Lightbulb className="h-3 w-3 text-yellow-500" />
                Key Insights
              </div>
              <ul className="space-y-1">
                {info.keyInsights.map((item, i) => (
                  <li key={i} className="text-[11px] text-zinc-500 flex items-start gap-1.5">
                    <span className="text-yellow-600 mt-0.5">→</span>
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
