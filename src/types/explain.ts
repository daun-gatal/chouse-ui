/**
 * TypeScript types for Query Explainer
 *
 * Defines interfaces for ClickHouse EXPLAIN output and query analysis.
 */

// ============================================
// EXPLAIN Plan Types
// ============================================

/**
 * ClickHouse EXPLAIN json = 1 output structure
 */
export interface ExplainPlanNode {
  "Node Type": string;
  "Description"?: string;
  "Filter"?: string;
  "Expression"?: string;
  "Read Rows"?: number;
  "Read Bytes"?: number;
  "Parts"?: number;
  "Marks"?: number;
  "Granules"?: number;
  "Selected Marks"?: number;
  "Selected Parts"?: number;
  "Selected Rows"?: number;
  "Selected Bytes"?: number;
  "Sorting Key"?: string;
  "Primary Key"?: string;
  "Indexes"?: ExplainIndex[];
  "Plans"?: ExplainPlanNode[];
  [key: string]: unknown;
}

export interface ExplainIndex {
  "Type": string;
  "Name"?: string;
  "Keys"?: string[];
  "Condition"?: string;
  "Initial Parts"?: number;
  "Selected Parts"?: number;
  "Initial Granules"?: number;
  "Selected Granules"?: number;
}

/**
 * EXPLAIN ESTIMATE output structure
 */
export interface ExplainEstimate {
  database: string;
  table: string;
  parts: number;
  rows: number;
  marks: number;
}

/**
 * EXPLAIN PIPELINE output structure
 */
export interface ExplainPipeline {
  name: string;
  processors?: ExplainPipelineProcessor[];
}

export interface ExplainPipelineProcessor {
  name: string;
  type: string;
  inputs?: number;
  outputs?: number;
}

// ============================================
// EXPLAIN Types Enum
// ============================================

export type ExplainType = 'plan' | 'ast' | 'syntax' | 'pipeline' | 'estimate';

export const EXPLAIN_TYPES: Record<ExplainType, { label: string; description: string; query: string }> = {
  plan: {
    label: 'Plan',
    description: 'Execution plan with node types and data flow',
    query: 'EXPLAIN json = 1'
  },
  ast: {
    label: 'AST',
    description: 'Abstract Syntax Tree of the query',
    query: 'EXPLAIN AST'
  },
  syntax: {
    label: 'Syntax',
    description: 'Optimized/rewritten query after ClickHouse processing',
    query: 'EXPLAIN SYNTAX'
  },
  pipeline: {
    label: 'Pipeline',
    description: 'Processing pipeline and parallelism',
    query: 'EXPLAIN PIPELINE'
  },
  estimate: {
    label: 'Estimate',
    description: 'Estimated rows and bytes to read',
    query: 'EXPLAIN ESTIMATE'
  }
};

// ============================================
// Combined Explain Result
// ============================================

export interface ExplainResult {
  type: ExplainType;
  query: string;
  plan?: ExplainPlanNode;
  ast?: string;
  syntax?: string;
  pipeline?: string;
  estimate?: ExplainEstimate[];
  raw?: unknown;
}

// ============================================
// Query Complexity Types
// ============================================

export type ComplexityLevel = 'low' | 'medium' | 'high';

export interface QueryComplexity {
  score: number;
  level: ComplexityLevel;
  metrics: {
    tableCount: number;
    joinCount: number;
    subqueryDepth: number;
    aggregationCount: number;
    hasDistinct: boolean;
    hasGroupBy: boolean;
    hasOrderBy: boolean;
    hasLimit: boolean;
    hasPrewhere: boolean;
    hasWhere: boolean;
    columnCount: number;
    isSelectStar: boolean;
  };
}

// ============================================
// Performance Recommendation Types
// ============================================

export type RecommendationSeverity = 'info' | 'warning' | 'critical';

export interface PerformanceRecommendation {
  id: string;
  severity: RecommendationSeverity;
  title: string;
  description: string;
  suggestion?: string;
}

export const RECOMMENDATION_RULES = {
  SELECT_STAR: {
    id: 'select-star',
    severity: 'warning' as RecommendationSeverity,
    title: 'SELECT * Usage',
    description: 'Query uses SELECT * which retrieves all columns',
    suggestion: 'Select only the columns you need to reduce data transfer and improve performance'
  },
  MISSING_LIMIT: {
    id: 'missing-limit',
    severity: 'info' as RecommendationSeverity,
    title: 'No LIMIT Clause',
    description: 'Query does not have a LIMIT clause',
    suggestion: 'Add LIMIT for exploratory queries to avoid scanning the entire table'
  },
  PREWHERE_OPPORTUNITY: {
    id: 'prewhere-opportunity',
    severity: 'info' as RecommendationSeverity,
    title: 'PREWHERE Opportunity',
    description: 'WHERE clause could benefit from PREWHERE',
    suggestion: 'Use PREWHERE instead of WHERE for columns in the primary key to enable early filtering'
  },
  LARGE_JOIN: {
    id: 'large-join',
    severity: 'warning' as RecommendationSeverity,
    title: 'Multiple Table Joins',
    description: 'Query joins more than 2 tables',
    suggestion: 'Consider denormalization or materialized views for frequently joined data'
  },
  ORDER_WITHOUT_LIMIT: {
    id: 'order-without-limit',
    severity: 'warning' as RecommendationSeverity,
    title: 'ORDER BY Without LIMIT',
    description: 'Query has ORDER BY but no LIMIT clause',
    suggestion: 'Add LIMIT to avoid sorting the entire result set'
  },
  SUBQUERY_IN_WHERE: {
    id: 'subquery-in-where',
    severity: 'info' as RecommendationSeverity,
    title: 'Subquery in WHERE',
    description: 'Query uses a correlated subquery in WHERE clause',
    suggestion: 'Consider rewriting as a JOIN for better performance'
  },
  HIGH_CARDINALITY_GROUP_BY: {
    id: 'high-cardinality-groupby',
    severity: 'info' as RecommendationSeverity,
    title: 'GROUP BY with Many Columns',
    description: 'GROUP BY clause has many columns which may create many groups',
    suggestion: 'Consider reducing grouping columns or using sampling'
  }
};

// ============================================
// Cost Estimation Types
// ============================================

export interface CostEstimate {
  estimatedRows: number;
  estimatedBytes: number;
  parts: number;
  partitions?: number;
  tables: CostEstimateTable[];
}

export interface CostEstimateTable {
  database: string;
  table: string;
  rows: number;
  bytes: number;
  parts: number;
  marks: number;
}

// ============================================
// Node Type Styling
// ============================================

export type NodeCategory = 'read' | 'filter' | 'aggregate' | 'sort' | 'join' | 'expression' | 'other';

export interface NodeStyle {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
}

export const NODE_CATEGORIES: Record<string, NodeCategory> = {
  // Read operations
  'ReadFromMergeTree': 'read',
  'ReadFromMemory': 'read',
  'ReadFromStorage': 'read',
  'ReadFromSystemNumbers': 'read',
  'ReadFromRemote': 'read',
  'ReadFromURL': 'read',
  'ReadFromInput': 'read',
  'TableScan': 'read',

  // Filter operations
  'Filter': 'filter',
  'FilterByKey': 'filter',
  'Prewhere': 'filter',
  'Where': 'filter',

  // Aggregation operations
  'Aggregating': 'aggregate',
  'AggregatingTransform': 'aggregate',
  'MergingAggregated': 'aggregate',
  'Rollup': 'aggregate',
  'Cube': 'aggregate',
  'GroupBy': 'aggregate',

  // Sorting operations
  'Sorting': 'sort',
  'MergeSorting': 'sort',
  'MergingSorted': 'sort',
  'PartialSorting': 'sort',
  'FinishSorting': 'sort',
  'OrderBy': 'sort',

  // Join operations
  'Join': 'join',
  'HashJoin': 'join',
  'MergeJoin': 'join',
  'CrossJoin': 'join',
  'FilledJoin': 'join',

  // Expression/Transform operations
  'Expression': 'expression',
  'ExpressionTransform': 'expression',
  'AddingConstColumn': 'expression',
  'Converting': 'expression',
  'Projection': 'expression'
};

export const NODE_STYLES: Record<NodeCategory, NodeStyle> = {
  read: {
    color: '#3b82f6', // blue
    bgColor: 'rgba(59, 130, 246, 0.1)',
    borderColor: 'rgba(59, 130, 246, 0.5)',
    icon: 'Database'
  },
  filter: {
    color: '#eab308', // yellow
    bgColor: 'rgba(234, 179, 8, 0.1)',
    borderColor: 'rgba(234, 179, 8, 0.5)',
    icon: 'Filter'
  },
  aggregate: {
    color: '#a855f7', // purple
    bgColor: 'rgba(168, 85, 247, 0.1)',
    borderColor: 'rgba(168, 85, 247, 0.5)',
    icon: 'Calculator'
  },
  sort: {
    color: '#22c55e', // green
    bgColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.5)',
    icon: 'ArrowUpDown'
  },
  join: {
    color: '#f97316', // orange
    bgColor: 'rgba(249, 115, 22, 0.1)',
    borderColor: 'rgba(249, 115, 22, 0.5)',
    icon: 'GitMerge'
  },
  expression: {
    color: '#6b7280', // gray
    bgColor: 'rgba(107, 114, 128, 0.1)',
    borderColor: 'rgba(107, 114, 128, 0.5)',
    icon: 'Code'
  },
  other: {
    color: '#71717a', // zinc
    bgColor: 'rgba(113, 113, 122, 0.1)',
    borderColor: 'rgba(113, 113, 122, 0.5)',
    icon: 'Box'
  }
};

/**
 * Get node category from node type string
 */
export function getNodeCategory(nodeType: string): NodeCategory {
  return NODE_CATEGORIES[nodeType] || 'other';
}

/**
 * Get node style from node type string
 */
export function getNodeStyle(nodeType: string): NodeStyle {
  const category = getNodeCategory(nodeType);
  return NODE_STYLES[category];
}
