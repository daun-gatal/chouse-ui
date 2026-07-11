/**
 * Tests for AI Chat route (invoke request validation)
 */

import { describe, it, expect } from "bun:test";
import { InvokeRequestSchema, MAX_MESSAGE_LENGTH, MAX_MESSAGES_PAYLOAD, parseToolResult } from "./ai-chat";

describe("AI Chat route", () => {
    describe("InvokeRequestSchema", () => {
        it("accepts valid payload with required fields", () => {
            const result = InvokeRequestSchema.safeParse({
                threadId: "thread-1",
                message: "Hello",
            });
            expect(result.success).toBe(true);
        });

        it("accepts valid payload with messages array", () => {
            const result = InvokeRequestSchema.safeParse({
                threadId: "thread-1",
                message: "Hi",
                messages: [
                    { role: "user" as const, content: "A" },
                    { role: "assistant" as const, content: "B" },
                ],
            });
            expect(result.success).toBe(true);
        });

        it("rejects missing threadId", () => {
            const result = InvokeRequestSchema.safeParse({
                message: "Hello",
            });
            expect(result.success).toBe(false);
        });

        it("rejects empty threadId", () => {
            const result = InvokeRequestSchema.safeParse({
                threadId: "",
                message: "Hello",
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing message", () => {
            const result = InvokeRequestSchema.safeParse({
                threadId: "thread-1",
            });
            expect(result.success).toBe(false);
        });

        it("rejects message exceeding max length", () => {
            const result = InvokeRequestSchema.safeParse({
                threadId: "thread-1",
                message: "x".repeat(MAX_MESSAGE_LENGTH + 1),
            });
            expect(result.success).toBe(false);
        });

        it("rejects messages array exceeding max count", () => {
            const messages = Array.from({ length: MAX_MESSAGES_PAYLOAD + 1 }, (_, i) => ({
                role: i % 2 === 0 ? "user" : "assistant",
                content: `msg ${i}`,
            }));
            const result = InvokeRequestSchema.safeParse({
                threadId: "thread-1",
                message: "Hi",
                messages,
            });
            expect(result.success).toBe(false);
        });

        it("rejects messages with invalid role", () => {
            const result = InvokeRequestSchema.safeParse({
                threadId: "thread-1",
                message: "Hi",
                messages: [{ role: "system", content: "x" }],
            });
            expect(result.success).toBe(false);
        });
    });
});

describe("parseToolResult", () => {
    const chart = {
        chartType: "bar",
        rows: [{ label: "A", count: "2" }],
        columns: [{ name: "label", type: "String" }, { name: "count", type: "UInt64" }],
        xAxis: "label",
        yAxis: "count",
        colorScheme: "violet",
    };

    it("parses a JSON-serialized chart tool result", () => {
        expect(parseToolResult(JSON.stringify(chart))).toEqual(chart);
    });

    it("unwraps ToolMessage content and artifacts", () => {
        expect(parseToolResult({ content: JSON.stringify(chart) })).toEqual(chart);
        expect(parseToolResult({ artifact: chart, content: "Chart ready" })).toEqual(chart);
    });
});
