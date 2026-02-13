import { AppError } from "../types";

export interface ColumnDefinition {
    name: string;
    type: string;
    nullable: boolean;
    sampleValue?: any;
}

export interface InferenceResult {
    columns: ColumnDefinition[];
    preview: any[];
}

export class InferenceService {
    /**
     * Infers schema from a sample of file content
     * @param content Sample content (first N lines/bytes)
     * @param format Data format
     */
    inferSchema(content: string, format: string, hasHeader: boolean = true): InferenceResult {
        if (!content || content.trim().length === 0) {
            return { columns: [], preview: [] };
        }

        const normalizedFormat = format.toUpperCase();

        if (normalizedFormat === 'CSV') {
            return this.inferDSV(content, ',', hasHeader);
        } else if (normalizedFormat === 'TSV') {
            return this.inferDSV(content, '\t', hasHeader);
        } else if (normalizedFormat === 'JSON') {
            return this.inferJSON(content);
        } else {
            throw AppError.badRequest(`Unsupported format for schema inference: ${format}`);
        }
    }

    private inferDSV(content: string, delimiter: string, hasHeader: boolean = true): InferenceResult {
        const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length === 0) return { columns: [], preview: [] };

        let headers: string[];
        let dataStartIdx = 0;

        if (hasHeader) {
            if (lines.length < 2) {
                // Only header available
                headers = this.parseDSVLine(lines[0], delimiter);
                const columns = headers.map(h => ({ name: this.sanitizeColumnName(h), type: 'String', nullable: true } as ColumnDefinition));
                return { columns, preview: [] };
            }
            headers = this.parseDSVLine(lines[0], delimiter);
            dataStartIdx = 1;
        } else {
            // No header, generate column names based on first row
            const firstRowItems = this.parseDSVLine(lines[0], delimiter);
            headers = firstRowItems.map((_, i) => `column_${i + 1}`);
            dataStartIdx = 0;
        }

        const dataSample = lines.slice(dataStartIdx, dataStartIdx + 50); // Analyze up to 50 rows
        const previewRows: any[] = [];

        // Initialize columns
        const columns: ColumnDefinition[] = headers.map(name => ({
            name: this.sanitizeColumnName(name),
            type: 'String', // Default
            nullable: false,
            sampleValue: undefined
        }));

        // Parse all sample rows for preview and type detection
        const parsedRows = dataSample.map(line => this.parseDSVLine(line, delimiter));

        // Detect types
        for (let c = 0; c < headers.length; c++) {
            const values = [];
            let hasNulls = false;

            for (let r = 0; r < parsedRows.length; r++) {
                const row = parsedRows[r];
                // Initialize preview object if needed
                if (!previewRows[r]) previewRows[r] = {};

                // Handle mismatched row usage gracefully
                if (row.length > c) {
                    const val = row[c];
                    if (val === '' || val === 'NULL' || val === 'null') {
                        hasNulls = true;
                        previewRows[r][headers[c]] = null;
                    } else {
                        values.push(val);
                        previewRows[r][headers[c]] = val;
                    }
                } else {
                    hasNulls = true; // Missing column treated as null
                    previewRows[r][headers[c]] = null;
                }
            }

            columns[c].type = this.detectType(values);
            columns[c].nullable = hasNulls;
            if (values.length > 0) {
                columns[c].sampleValue = values[0];
            }
        }

        return { columns, preview: previewRows };
    }

    public normalizeJSON(content: string): any[] {
        let objects: any[] = [];
        try {
            // Try parsing as entire JSON
            const parsed = JSON.parse(content);

            if (Array.isArray(parsed)) {
                objects = parsed;
            } else if (typeof parsed === 'object' && parsed !== null) {
                // Check for common wrapper keys
                const commonKeys = ['data', 'items', 'rows', 'results', 'value'];
                const foundKey = commonKeys.find(k => Array.isArray(parsed[k]));

                if (foundKey) {
                    objects = parsed[foundKey];
                } else {
                    // Check if it's a Map (key-value pairs where values are rows)
                    // Heuristic: If we have > 10 keys and values are objects, assume it's a collection
                    const keys = Object.keys(parsed);
                    const firstVal = parsed[keys[0]];
                    if (keys.length > 10 && typeof firstVal === 'object' && firstVal !== null) {
                        objects = Object.values(parsed);
                    } else {
                        // Treat as single row
                        objects = [parsed];
                    }
                }
            } else {
                // Primitive value?
                objects = [];
            }
        } catch {
            // Try parsing as line-delimited
            const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
            for (const line of lines) {
                try {
                    objects.push(JSON.parse(line));
                } catch {
                    // Ignore bad lines
                }
            }
        }
        return objects;
    }

    private inferJSON(content: string): InferenceResult {
        // Expecting JSONEachRow (newline delimited JSON objects) or a JSON array
        // Use normalized parser to handle various JSON shapes (Arrays, Maps, Wrappers)
        const objects = this.normalizeJSON(content);

        // Limit for preview
        const previewObjects = objects.slice(0, 50);

        if (previewObjects.length === 0) return { columns: [], preview: [] };

        // Collect all keys from sample
        const allKeys = new Set<string>();
        previewObjects.forEach(obj => Object.keys(obj).forEach(k => allKeys.add(k)));

        const columns: ColumnDefinition[] = [];

        for (const key of allKeys) {
            const values: string[] = [];
            let hasNulls = false;

            for (const obj of previewObjects) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    const val = obj[key];
                    if (val === null || val === undefined) {
                        hasNulls = true;
                    } else if (typeof val === 'object') {
                        // Complex types treated as String (JSON representation) for simplicity
                        values.push(JSON.stringify(val));
                    } else {
                        values.push(String(val));
                    }
                } else {
                    hasNulls = true;
                }
            }

            columns.push({
                name: this.sanitizeColumnName(key),
                type: this.detectType(values),
                nullable: hasNulls,
                sampleValue: values[0]
            });
        }

        return { columns, preview: previewObjects };
    }

    private detectType(values: string[]): string {
        if (values.length === 0) return 'String';

        let isInt = true;
        let isFloat = true;
        let isBool = true;
        let isDateTime = true;
        let isDate = true;

        for (const val of values) {
            // Check Int
            if (isInt && !/^-?\d+$/.test(val)) isInt = false;

            // Check Float
            // Allow . or , for decimals? Standardize on dot.
            if (isFloat && !/^-?\d+(\.\d+)?$/.test(val)) isFloat = false;

            // Check Bool
            const lower = val.toLowerCase();
            if (isBool && !['true', 'false', '0', '1'].includes(lower)) isBool = false;

            // Check Date/DateTime
            // Simple ISO check or standard formats
            if ((isDate || isDateTime) && isNaN(Date.parse(val))) {
                isDate = false;
                isDateTime = false;
            }

            if (isDate && val.includes('T') || val.includes(':')) {
                // Likely DateTime if it has time components
                isDate = false;
            }
        }

        if (isInt) {
            // Check range for Int32 vs Int64? Default to Int64 usually safe but Int32 is standard
            return 'Int64';
        }
        if (isBool) return 'Bool';
        if (isFloat) return 'Float64';
        if (isDate) return 'Date';
        if (isDateTime) return 'DateTime';

        return 'String';
    }

    private parseDSVLine(line: string, delimiter: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++; // Skip escaped quote
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    private sanitizeColumnName(name: string): string {
        // Replace non-alphanumeric with underbar, ensure starts with letter/underscore
        let safe = name.replace(/[^a-zA-Z0-9_]/g, '_');
        if (/^[0-9]/.test(safe)) safe = '_' + safe;
        return safe || 'column';
    }
}
