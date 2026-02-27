/**
 * Tests for AI Chat route (stream request validation)
 */

import { describe, it, expect } from "bun:test";
import { StreamRequestSchema, MAX_MESSAGE_LENGTH, MAX_MESSAGES_PAYLOAD } from "./ai-chat";

describe("AI Chat route", () => {
    describe("StreamRequestSchema", () => {
        it("accepts valid payload with required fields", () => {
            const result = StreamRequestSchema.safeParse({
                threadId: "thread-1",
                message: "Hello",
            });
            expect(result.success).toBe(true);
        });

        it("accepts valid payload with messages array", () => {
            const result = StreamRequestSchema.safeParse({
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
            const result = StreamRequestSchema.safeParse({
                message: "Hello",
            });
            expect(result.success).toBe(false);
        });

        it("rejects empty threadId", () => {
            const result = StreamRequestSchema.safeParse({
                threadId: "",
                message: "Hello",
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing message", () => {
            const result = StreamRequestSchema.safeParse({
                threadId: "thread-1",
            });
            expect(result.success).toBe(false);
        });

        it("rejects message exceeding max length", () => {
            const result = StreamRequestSchema.safeParse({
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
            const result = StreamRequestSchema.safeParse({
                threadId: "thread-1",
                message: "Hi",
                messages,
            });
            expect(result.success).toBe(false);
        });

        it("rejects messages with invalid role", () => {
            const result = StreamRequestSchema.safeParse({
                threadId: "thread-1",
                message: "Hi",
                messages: [{ role: "system", content: "x" }],
            });
            expect(result.success).toBe(false);
        });
    });
});
