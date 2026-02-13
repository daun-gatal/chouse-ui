/**
 * Query Analyzer Service
 *
 * Analyzes SQL queries for complexity metrics and performance recommendations.
 * Uses the existing SQL parser infrastructure for AST analysis.
 */

// SQL parser imports available if needed for future AST-based analysis
// import { parseStatement, splitSqlStatements, type ParsedStatement } from '../middleware/sqlParser';

// ============================================
// Types
// ============================================

export type ComplexityLevel = 'low' | 'medium' | 'high';
export type RecommendationSeverity = 'info' | 'warning' | 'critical';

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

export interface PerformanceRecommendation {
  id: string;
  severity: RecommendationSeverity;
  title: string;
  description: string;
  suggestion?: string;
}

export interface QueryAnalysisResult {
  complexity: QueryComplexity;
  recommendations: PerformanceRecommendation[];
}

// ============================================
// Complexity Analysis
// ============================================

/**
 * Analyze query complexity from SQL string
 */
export function analyzeQueryComplexity(sql: string): QueryComplexity {
  const metrics = extractQueryMetrics(sql);
  const score = calculateComplexityScore(metrics);
  const level = getComplexityLevel(score);

  return {
    score,
    level,
    metrics
  };
}

/**
 * Extract metrics from SQL query
 */
function extractQueryMetrics(sql: string): QueryComplexity['metrics'] {
  // Remove comments first
  const sqlWithoutComments = removeComments(sql);

  // Extract CTE names and find where main query starts
  const cteNames = extractCTENames(sqlWithoutComments);
  const mainQuery = extractMainQuery(sqlWithoutComments);

  // Extract unique table names from the ENTIRE query (excluding CTEs from count)
  const tables = extractUniqueTableNames(sqlWithoutComments, cteNames);
  const tableCount = tables.size;

  // Count JOIN keywords in main query only (not CTEs)
  const joinCount = countJoins(mainQuery);

  // Count subqueries in main query only (CTEs are not subqueries)
  const subqueryDepth = countSubqueryDepth(mainQuery);

  // Count aggregations in main query only
  const aggregationCount = countAggregations(mainQuery);

  // Check for specific clauses in the main query only
  const hasDistinct = /\bSELECT\s+DISTINCT\b/i.test(mainQuery);
  const hasGroupBy = /\bGROUP\s+BY\b/i.test(mainQuery);
  const hasOrderBy = /\bORDER\s+BY\b/i.test(mainQuery);
  const hasLimit = /\bLIMIT\b/i.test(mainQuery);
  const hasPrewhere = /\bPREWHERE\b/i.test(mainQuery);
  const hasWhere = /\bWHERE\b/i.test(mainQuery);

  // Check for SELECT * in main query
  const isSelectStar = /\bSELECT\s+\*/i.test(mainQuery);

  // Count columns in main query's SELECT clause
  const columnCount = countSelectColumns(mainQuery);

  return {
    tableCount,
    joinCount,
    subqueryDepth,
    aggregationCount,
    hasDistinct,
    hasGroupBy,
    hasOrderBy,
    hasLimit,
    hasPrewhere,
    hasWhere,
    columnCount,
    isSelectStar
  };
}

/**
 * Remove SQL comments
 */
function removeComments(sql: string): string {
  // Remove single-line comments (-- ...)
  let result = sql.replace(/--[^\n]*/g, '');
  // Remove multi-line comments (/* ... */)
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

/**
 * Extract CTE (Common Table Expression) names from WITH clause
 * Uses parenthesis tracking to properly handle nested CTEs
 */
function extractCTENames(sql: string): Set<string> {
  const cteNames = new Set<string>();

  // Remove string literals to avoid false matches
  const sqlWithoutStrings = removeStringLiterals(sql);

  // Check if query starts with WITH
  const withMatch = sqlWithoutStrings.match(/\bWITH\s+/i);
  if (!withMatch) return cteNames;

  const startIdx = withMatch.index! + withMatch[0].length;
  let i = startIdx;
  let depth = 0;
  let currentCteName = '';
  let lookingForName = true;
  let lookingForAs = false;

  while (i < sqlWithoutStrings.length) {
    const char = sqlWithoutStrings[i];

    // Track parenthesis depth
    if (char === '(') {
      depth++;
      if (lookingForAs && depth === 1) {
        // Found "name AS (" - this is a CTE
        if (currentCteName) {
          cteNames.add(currentCteName.toLowerCase());
        }
        lookingForName = false;
        lookingForAs = false;
      }
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        // CTE body closed, look for comma or main query
        lookingForName = true;
        currentCteName = '';
      }
    } else if (depth === 0) {
      // We're outside CTE bodies
      if (lookingForName && /[a-zA-Z_]/.test(char)) {
        // Start of identifier
        let word = '';
        while (i < sqlWithoutStrings.length && /[a-zA-Z0-9_]/.test(sqlWithoutStrings[i])) {
          word += sqlWithoutStrings[i];
          i++;
        }
        i--; // Back up one since loop will increment

        const upperWord = word.toUpperCase();
        if (upperWord === 'SELECT') {
          // Reached main query, stop
          break;
        } else if (upperWord === 'AS') {
          lookingForAs = true;
          lookingForName = false;
        } else if (upperWord !== 'WITH' && upperWord !== 'RECURSIVE') {
          currentCteName = word;
          lookingForAs = false;
        }
      } else if (char === ',') {
        // Another CTE coming
        lookingForName = true;
        currentCteName = '';
      }
    }

    i++;
  }

  return cteNames;
}

/**
 * Remove string literals from SQL to avoid false regex matches
 */
function removeStringLiterals(sql: string): string {
  return sql.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

/**
 * Extract the main query (after WITH clause if present)
 * Uses parenthesis tracking to skip CTE bodies
 * Works directly with original SQL to maintain correct positions
 */
function extractMainQuery(sql: string): string {
  // Check if query starts with WITH (case insensitive, allowing whitespace)
  const withMatch = sql.match(/^\s*WITH\s+/i);
  if (!withMatch) return sql;

  const startIdx = withMatch[0].length;
  let i = startIdx;
  let depth = 0;
  let inString = false;
  let stringChar = '';

  while (i < sql.length) {
    const char = sql[i];

    // Handle string literals
    if ((char === "'" || char === '"') && (i === 0 || sql[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    if (!inString) {
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      } else if (depth === 0) {
        // Check if we've reached the main SELECT (not inside CTE body)
        const remaining = sql.substring(i);
        if (/^SELECT\b/i.test(remaining)) {
          return sql.substring(i);
        }
      }
    }

    i++;
  }

  return sql;
}

/**
 * Extract unique table names from SQL query, excluding CTEs
 */
function extractUniqueTableNames(sql: string, cteNames: Set<string>): Set<string> {
  const tables = new Set<string>();

  // Remove string literals to avoid false matches
  const sqlWithoutStrings = sql
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');

  // Match table references after FROM
  // Handles: FROM table, FROM db.table, FROM `table`, FROM table AS alias
  const fromRegex = /\bFROM\s+(?!\s*\()([`"]?[\w]+[`"]?(?:\.[`"]?[\w]+[`"]?)?)/gi;

  let match;
  while ((match = fromRegex.exec(sqlWithoutStrings)) !== null) {
    if (match[1]) {
      const tableName = match[1].replace(/[`"]/g, '').toLowerCase();
      // Exclude CTEs and subquery-like patterns
      if (!cteNames.has(tableName) && !tableName.includes('(')) {
        tables.add(tableName);
      }
    }
  }

  // Match table references after JOIN (various types)
  const joinRegex = /\bJOIN\s+(?!\s*\()([`"]?[\w]+[`"]?(?:\.[`"]?[\w]+[`"]?)?)/gi;

  while ((match = joinRegex.exec(sqlWithoutStrings)) !== null) {
    if (match[1]) {
      const tableName = match[1].replace(/[`"]/g, '').toLowerCase();
      // Exclude CTEs and subquery-like patterns
      if (!cteNames.has(tableName) && !tableName.includes('(')) {
        tables.add(tableName);
      }
    }
  }

  // Handle comma-separated tables in FROM: FROM t1, t2, t3
  const fromCommaRegex = /\bFROM\s+([^,\s]+(?:\s*,\s*[^,\s(]+)*)/gi;
  while ((match = fromCommaRegex.exec(sqlWithoutStrings)) !== null) {
    if (match[1]) {
      const tableList = match[1].split(',');
      for (const t of tableList) {
        const tableName = t.trim().split(/\s+/)[0].replace(/[`"]/g, '').toLowerCase();
        if (tableName && !cteNames.has(tableName) && !tableName.includes('(') && !/^(where|join|left|right|inner|outer|cross|on|prewhere|group|order|limit|having|union)$/i.test(tableName)) {
          tables.add(tableName);
        }
      }
    }
  }

  return tables;
}

/**
 * Count JOIN operations (avoids double-counting)
 */
function countJoins(sql: string): number {
  const sqlWithoutStrings = removeStringLiterals(sql);

  // Single comprehensive regex that matches all JOIN types
  // This captures: [GLOBAL] [ANY|ALL] [INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|ASYNC] [OUTER] JOIN
  const joinRegex = /\b(?:GLOBAL\s+)?(?:ANY\s+|ALL\s+)?(?:INNER\s+|LEFT\s+|RIGHT\s+|FULL\s+|CROSS\s+|NATURAL\s+|ASYNC\s+)?(?:OUTER\s+)?JOIN\b/gi;

  const matches = sqlWithoutStrings.match(joinRegex);
  return matches ? matches.length : 0;
}

/**
 * Count aggregation functions
 * Note: Only counts when followed by '(' to distinguish from keywords
 */
function countAggregations(sql: string): number {
  // Standard SQL and ClickHouse aggregation functions
  // Excludes 'ANY' as it conflicts with JOIN syntax (ANY JOIN)
  const aggregationFunctions = [
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT',
    'ANYIF', 'ANYLAST', 'ARGMIN', 'ARGMAX',
    'QUANTILE', 'QUANTILES', 'QUANTILETIMING', 'QUANTILEEXACT', 'QUANTILEDETERMINISTIC',
    'MEDIAN', 'UNIQ', 'UNIQEXACT', 'UNIQCOMBINED', 'UNIQCOMBINED64', 'UNIQHLL12', 'UNIQTHETA',
    'GROUPARRAY', 'GROUPUNIQARRAY', 'GROUPARRAYINSERTAT', 'GROUPARRAYSAMPLE',
    'GROUPBITAND', 'GROUPBITOR', 'GROUPBITXOR',
    'SUMWITHOVERFLOW', 'SUMMAP', 'AVGWEIGHTED',
    'STDDEVPOP', 'STDDEVSAMP', 'VARPOP', 'VARSAMP',
    'COVARPOP', 'COVARSAMP', 'CORR', 'ENTROPY',
    'SIMPLELINEARREGRESSION', 'STOCHASTICLINEARREGRESSION',
    'TOPK', 'TOPKWEIGHTED',
    'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE'
  ];

  const sqlWithoutStrings = removeStringLiterals(sql);
  let count = 0;

  for (const func of aggregationFunctions) {
    // Match function name followed by '(' with optional whitespace
    const regex = new RegExp(`\\b${func}\\s*\\(`, 'gi');
    const matches = sqlWithoutStrings.match(regex) || [];
    count += matches.length;
  }

  return count;
}

/**
 * Count subquery nesting depth
 * Note: This should be called with the main query (after CTEs)
 * so CTE definitions are not counted as subqueries
 */
function countSubqueryDepth(sql: string): number {
  let depth = 0;
  let maxDepth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    // Handle string literals
    if ((char === "'" || char === '"') && (i === 0 || sql[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (!inString) {
      if (char === '(') {
        // Check if this is a SELECT subquery
        const remaining = sql.substring(i + 1).trimStart();
        if (/^SELECT\b/i.test(remaining)) {
          depth++;
          maxDepth = Math.max(maxDepth, depth);
        }
      } else if (char === ')') {
        if (depth > 0) depth--;
      }
    }
  }

  return maxDepth;
}

/**
 * Count columns in SELECT clause
 */
function countSelectColumns(sql: string): number {
  // Extract SELECT clause (before FROM)
  const selectMatch = sql.match(/\bSELECT\s+(.*?)\s+FROM\b/is);
  if (!selectMatch) return 0;

  const selectClause = selectMatch[1];

  // If it's SELECT *, return 0 (unknown)
  if (/^\s*\*\s*$/.test(selectClause)) return 0;

  // Count commas outside of parentheses (rough estimate)
  let count = 1;
  let parenDepth = 0;

  for (const char of selectClause) {
    if (char === '(') parenDepth++;
    else if (char === ')') parenDepth--;
    else if (char === ',' && parenDepth === 0) count++;
  }

  return count;
}

/**
 * Calculate complexity score (0-100)
 */
function calculateComplexityScore(metrics: QueryComplexity['metrics']): number {
  let score = 0;

  // Table count (max 20 points)
  score += Math.min(metrics.tableCount * 5, 20);

  // Join count (max 15 points)
  score += Math.min(metrics.joinCount * 5, 15);

  // Subquery depth (max 20 points)
  score += Math.min(metrics.subqueryDepth * 10, 20);

  // Aggregation count (max 10 points)
  score += Math.min(metrics.aggregationCount * 3, 10);

  // Modifiers (max 15 points)
  if (metrics.hasDistinct) score += 5;
  if (metrics.hasGroupBy) score += 5;
  if (metrics.hasOrderBy) score += 3;

  // SELECT * penalty (max 10 points)
  if (metrics.isSelectStar) score += 10;

  // Column count (max 10 points)
  if (metrics.columnCount > 20) score += 10;
  else if (metrics.columnCount > 10) score += 5;

  return Math.min(score, 100);
}

/**
 * Get complexity level from score
 */
function getComplexityLevel(score: number): ComplexityLevel {
  if (score < 30) return 'low';
  if (score < 60) return 'medium';
  return 'high';
}

// ============================================
// Performance Recommendations
// ============================================

/**
 * Generate performance recommendations based on query analysis
 */
export function generateRecommendations(sql: string, metrics: QueryComplexity['metrics']): PerformanceRecommendation[] {
  const recommendations: PerformanceRecommendation[] = [];
  const sqlUpper = sql.toUpperCase();
  const sqlWithoutStrings = removeStringLiterals(sql);

  // ========================================
  // Critical Rules (Performance Impact: High)
  // ========================================

  // Rule: SELECT * usage
  if (metrics.isSelectStar) {
    recommendations.push({
      id: 'select-star',
      severity: 'critical',
      title: 'SELECT * Usage Detected',
      description: 'Query uses SELECT * which retrieves all columns from the table, increasing I/O and memory usage.',
      suggestion: 'Select only the columns you need. This reduces data transfer, improves cache efficiency, and speeds up queries significantly.'
    });
  }

  // Rule: ORDER BY without LIMIT on large results
  if (metrics.hasOrderBy && !metrics.hasLimit) {
    recommendations.push({
      id: 'order-without-limit',
      severity: 'critical',
      title: 'ORDER BY Without LIMIT',
      description: 'Sorting the entire result set without LIMIT requires loading all data into memory before returning results.',
      suggestion: 'Add LIMIT clause to reduce memory usage and return results faster. If you need all sorted data, consider using external sorting or pagination.'
    });
  }

  // Rule: Large JOIN count
  if (metrics.joinCount > 2) {
    recommendations.push({
      id: 'large-join',
      severity: 'critical',
      title: 'Multiple Table Joins',
      description: `Query joins ${metrics.joinCount + 1} tables. Each additional join multiplies the potential result set and increases memory usage.`,
      suggestion: 'Consider denormalization, materialized views, or splitting into multiple queries. Use GLOBAL joins only when necessary.'
    });
  }

  // Rule: Deep subqueries
  if (metrics.subqueryDepth > 2) {
    recommendations.push({
      id: 'deep-subquery',
      severity: 'critical',
      title: 'Deeply Nested Subqueries',
      description: `Query has ${metrics.subqueryDepth} levels of nested subqueries, which can prevent query optimization.`,
      suggestion: 'Rewrite using CTEs (WITH clause) or JOINs for better query planning and readability.'
    });
  }

  // ========================================
  // Warning Rules (Performance Impact: Medium)
  // ========================================

  // Rule: PREWHERE opportunity
  if (metrics.hasWhere && !metrics.hasPrewhere) {
    recommendations.push({
      id: 'prewhere-opportunity',
      severity: 'warning',
      title: 'PREWHERE Optimization Available',
      description: 'PREWHERE filters data before reading all columns, reducing I/O significantly for selective queries.',
      suggestion: 'Move highly selective filter conditions to PREWHERE clause. Best for columns in the primary key or with low cardinality.'
    });
  }

  // Rule: Missing LIMIT for non-aggregate queries
  if (!metrics.hasLimit && !metrics.hasGroupBy && !metrics.aggregationCount) {
    recommendations.push({
      id: 'missing-limit',
      severity: 'warning',
      title: 'No LIMIT Clause',
      description: 'Query may return millions of rows without a LIMIT clause, causing high memory usage and slow response.',
      suggestion: 'Add LIMIT for exploratory queries. For exports, consider using async queries or chunked downloads.'
    });
  }

  // Rule: DISTINCT with many columns
  if (metrics.hasDistinct && metrics.columnCount > 5) {
    recommendations.push({
      id: 'distinct-many-columns',
      severity: 'warning',
      title: 'DISTINCT with Many Columns',
      description: `DISTINCT on ${metrics.columnCount} columns requires hashing all values, using significant memory.`,
      suggestion: 'Reduce columns in SELECT or use GROUP BY with specific columns for better performance.'
    });
  }

  // Rule: High aggregation count
  if (metrics.aggregationCount > 5) {
    recommendations.push({
      id: 'many-aggregations',
      severity: 'warning',
      title: 'Many Aggregation Functions',
      description: `Query uses ${metrics.aggregationCount} aggregation functions, increasing computation time.`,
      suggestion: 'Consider splitting into multiple queries or using materialized views for pre-computed aggregates.'
    });
  }

  // Rule: Large column count
  if (metrics.columnCount > 20) {
    recommendations.push({
      id: 'many-columns',
      severity: 'warning',
      title: 'Many Columns Selected',
      description: `Query selects ${metrics.columnCount} columns, increasing data transfer and processing time.`,
      suggestion: 'Review if all columns are necessary. Consider using column aliases or computed columns only when needed.'
    });
  }

  // Rule: Cartesian product risk (multiple tables without JOIN)
  if (metrics.tableCount > 1 && metrics.joinCount === 0) {
    recommendations.push({
      id: 'cartesian-product',
      severity: 'warning',
      title: 'Potential Cartesian Product',
      description: 'Multiple tables without explicit JOIN conditions may create a Cartesian product (all possible row combinations).',
      suggestion: 'Add explicit JOIN conditions or WHERE clauses to link tables. Use CROSS JOIN only when intentional.'
    });
  }

  // ========================================
  // Informational Rules (Best Practices)
  // ========================================

  // Rule: Using LIKE with leading wildcard
  if (/LIKE\s+['"][%_]/.test(sqlUpper)) {
    recommendations.push({
      id: 'like-leading-wildcard',
      severity: 'info',
      title: 'LIKE with Leading Wildcard',
      description: 'LIKE patterns starting with % or _ cannot use indexes and require full table scans.',
      suggestion: 'Consider using full-text search indexes, tokenbf_v1 index, or restructuring data for prefix matching.'
    });
  }

  // Rule: Using NOT IN or NOT EXISTS
  if (/\bNOT\s+(IN|EXISTS)\b/i.test(sqlUpper)) {
    recommendations.push({
      id: 'not-in-usage',
      severity: 'info',
      title: 'NOT IN/NOT EXISTS Usage',
      description: 'NOT IN and NOT EXISTS can be slow on large datasets as they require checking every value.',
      suggestion: 'Consider using LEFT JOIN with IS NULL check or anti-join patterns for better performance.'
    });
  }

  // Rule: Using UNION instead of UNION ALL
  if (/\bUNION\b(?!\s+ALL)/i.test(sqlWithoutStrings)) {
    recommendations.push({
      id: 'union-without-all',
      severity: 'info',
      title: 'UNION Without ALL',
      description: 'UNION removes duplicates which requires sorting and comparison of all rows.',
      suggestion: 'Use UNION ALL if duplicates are acceptable or already impossible, avoiding the deduplication overhead.'
    });
  }

  // Rule: Functions on indexed columns in WHERE
  if (/WHERE[^;]*\b(toDate|toString|lower|upper|toYear|toMonth)\s*\([^)]*\)/i.test(sqlWithoutStrings)) {
    recommendations.push({
      id: 'function-on-indexed-column',
      severity: 'info',
      title: 'Function Applied to Column in WHERE',
      description: 'Applying functions to columns in WHERE clause prevents index usage.',
      suggestion: 'Store pre-computed values or use expression indexes. Example: instead of toDate(timestamp) = \'2024-01-01\', filter on timestamp range.'
    });
  }

  // Rule: Missing GROUP BY with aggregations
  if (metrics.aggregationCount > 0 && !metrics.hasGroupBy && metrics.columnCount > metrics.aggregationCount) {
    recommendations.push({
      id: 'aggregate-without-groupby',
      severity: 'info',
      title: 'Aggregation Without GROUP BY',
      description: 'Query has both aggregate functions and non-aggregated columns without GROUP BY.',
      suggestion: 'Add GROUP BY for non-aggregated columns, or wrap non-aggregated columns in aggregate functions like any() or max().'
    });
  }

  // Rule: Subquery in SELECT clause
  if (/SELECT[^FROM]*\(\s*SELECT\b/i.test(sqlWithoutStrings)) {
    recommendations.push({
      id: 'subquery-in-select',
      severity: 'info',
      title: 'Subquery in SELECT Clause',
      description: 'Correlated subqueries in SELECT are executed for each row, which can be very slow.',
      suggestion: 'Rewrite using JOINs or window functions for better performance. CTEs can also help organize the query.'
    });
  }

  // Rule: Using IN with large list
  if (/\bIN\s*\([^)]{500,}\)/i.test(sqlWithoutStrings)) {
    recommendations.push({
      id: 'large-in-list',
      severity: 'info',
      title: 'Large IN List',
      description: 'IN clause with many values can be slow and hard to maintain.',
      suggestion: 'Consider using a temporary table, JOIN with a values list, or hasAny() for arrays.'
    });
  }

  // Rule: Using OR conditions that could use IN
  const orConditions = (sqlWithoutStrings.match(/\bOR\b/gi) || []).length;
  if (orConditions > 3) {
    recommendations.push({
      id: 'many-or-conditions',
      severity: 'info',
      title: 'Multiple OR Conditions',
      description: `Query has ${orConditions} OR conditions which can prevent index optimization.`,
      suggestion: 'Consider rewriting OR conditions on the same column as IN clause for better index usage.'
    });
  }

  // Rule: Suggest FINAL for ReplacingMergeTree
  if (/\bFINAL\b/i.test(sqlUpper)) {
    recommendations.push({
      id: 'final-usage',
      severity: 'info',
      title: 'FINAL Clause Usage',
      description: 'FINAL forces merge of all parts before returning results, which can be slow on large tables.',
      suggestion: 'Consider using OPTIMIZE TABLE periodically, or design queries to handle duplicates with aggregation.'
    });
  }

  // Rule: Complex expressions in GROUP BY
  if (metrics.hasGroupBy && /GROUP\s+BY[^;]*\([^)]+\)/i.test(sqlWithoutStrings)) {
    recommendations.push({
      id: 'complex-group-by',
      severity: 'info',
      title: 'Complex Expression in GROUP BY',
      description: 'Functions in GROUP BY are computed for every row, impacting performance.',
      suggestion: 'Pre-compute complex expressions in a CTE or subquery, or store computed values in the table.'
    });
  }

  // Sort recommendations by severity
  const severityOrder: Record<RecommendationSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2
  };
  recommendations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return recommendations;
}

/**
 * Full query analysis combining complexity and recommendations
 */
export function analyzeQuery(sql: string): QueryAnalysisResult {
  const complexity = analyzeQueryComplexity(sql);
  const recommendations = generateRecommendations(sql, complexity.metrics);

  return {
    complexity,
    recommendations
  };
}
