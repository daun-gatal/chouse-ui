import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { InferenceService } from "../services/inference";
import { getSession } from "../services/clickhouse";
import { AppError } from "../types";
import { Readable, PassThrough } from "stream";

const upload = new Hono();
const inferenceService = new InferenceService();

// Schema for create table/insert parameters
const createParams = z.object({
    database: z.string().min(1),
    table: z.string().min(1),
    format: z.string().default("CSV"),
    hasHeader: z.string().optional().default("true"),
    columns: z.string().optional(),
});

/**
 * Preview file content and infer schema
 * Expects multipart/form-data with 'file' field
 * Limited to first chunk/snippet for preview
 */
upload.post("/preview", async (c) => {
    try {
        const body = await c.req.parseBody();
        const file = body["file"];

        if (!file) {
            throw AppError.badRequest("File is required");
        }

        let content: string;
        let format = (body["format"] as string) || "CSV";
        // Parse hasHeader from formData (converts "true"/"false" string to boolean, default true)
        const hasHeaderRaw = body["hasHeader"];
        const hasHeader = hasHeaderRaw !== "false";

        if (file instanceof File) {
            // Limit preview to first 1MB to avoid memory issues
            const slice = file.slice(0, 1024 * 1024);
            content = await slice.text();
        } else if (typeof file === "string") {
            // Fallback for string content
            content = file.slice(0, 1024 * 1024);
        } else {
            throw AppError.badRequest("Invalid file format");
        }

        const columns = inferenceService.inferSchema(content, format, hasHeader);

        return c.json({
            success: true,
            data: columns,
        });
    } catch (error) {
        throw error instanceof AppError ? error : AppError.internal("Preview failed", error);
    }
});

/**
 * Stream data insertion
 * Expects raw body stream
 */
upload.post(
    "/create",
    zValidator("query", createParams),
    async (c) => {
        const { database, table, format, hasHeader, columns } = c.req.valid("query");
        const sessionId = c.req.header("x-clickhouse-session-id");
        const hasHeaderBool = hasHeader !== "false";

        const columnArray = columns ? columns.split(',') : undefined;

        if (!sessionId) {
            throw AppError.unauthorized("Session ID required");
        }

        const sessionEntry = getSession(sessionId);
        if (!sessionEntry) {
            throw AppError.unauthorized("Invalid or expired session");
        }

        const settings: Record<string, string | number> = {};
        if (hasHeaderBool) {
            if (format.toUpperCase() === 'CSV') {
                settings.input_format_csv_skip_first_lines = 1;
            } else if (format.toUpperCase() === 'TSV' || format.toUpperCase() === 'TABSEPARATED') {
                settings.input_format_tsv_skip_first_lines = 1;
            }
        }

        try {
            let insertFormat = format;
            let nodeStream: Readable;

            if (format.toUpperCase() === 'JSON' || format.toUpperCase() === 'JSONEACHROW') {
                // For JSON, we buffer and normalize to handle various shapes (Maps, Wrappers)
                const buffer = await c.req.arrayBuffer();
                const text = new TextDecoder().decode(buffer);

                // Use the shared normalization logic
                const objects = inferenceService.normalizeJSON(text);

                // Convert to object stream (default for Readable.from)
                nodeStream = Readable.from(objects);
                insertFormat = 'JSONEachRow';
            } else if (['CSV', 'TSV', 'TABSEPARATED'].includes(format.toUpperCase())) {
                // For CSV/TSV, we use a Byte Stream (objectMode: false)
                // We use 'TabSeparated' for TSV to satisfy ClickHouse client's format validation
                insertFormat = format.toUpperCase() === 'CSV' ? 'CSV' : 'TabSeparated';

                const passThrough = new PassThrough({ objectMode: false });
                nodeStream = passThrough;

                const webStream = c.req.raw.body;
                if (webStream) {
                    (async () => {
                        const reader = webStream.getReader();
                        try {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                // Write to passThrough and respect backpressure
                                if (!passThrough.write(value)) {
                                    await new Promise(resolve => passThrough.once('drain', resolve));
                                }
                            }
                            passThrough.end();
                        } catch (e) {
                            passThrough.destroy(e instanceof Error ? e : new Error(String(e)));
                        } finally {
                            reader.releaseLock();
                        }
                    })();
                }
            } else {
                // Fallback for other formats
                nodeStream = c.req.raw.body as any;
            }

            const result = await sessionEntry.service.insertStream(
                database,
                table,
                nodeStream,
                insertFormat,
                settings,
                columnArray
            );

            return c.json({
                success: true,
                data: {
                    queryId: result.queryId,
                },
            });
        } catch (error) {
            // Error is likely handled by insertStream but we wrap just in case
            throw error instanceof AppError ? error : AppError.internal("Insert failed", error);
        }
    }
);

export default upload;
