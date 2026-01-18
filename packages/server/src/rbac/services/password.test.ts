
import { describe, it, expect } from "bun:test";
import {
    hashPassword,
    verifyPassword,
    validatePasswordStrength,
    generateSecurePassword,
    needsRehash
} from "./password";

describe("Password Service", () => {
    describe("hashing", () => {
        it("should hash and verify password", async () => {
            const password = "securePassword123!";
            const hash = await hashPassword(password);

            expect(hash).not.toBe(password);
            expect(await verifyPassword(password, hash)).toBe(true);
            expect(await verifyPassword("wrong", hash)).toBe(false);
        });
    });

    describe("validatePasswordStrength", () => {
        it("should accept strong password", () => {
            const result = validatePasswordStrength("StrongPass123!");
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("should reject weak passwords", () => {
            const result = validatePasswordStrength("weak");
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Password must be at least 8 characters long");
        });

        it("should require numbers and special chars", () => {
            const result = validatePasswordStrength("PasswordOnly");
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Password must contain at least one number");
        });

        it("should reject common patterns", () => {
            const result = validatePasswordStrength("Password123!");
            // Depending on implementation, "Password" might be common
            // The implementation checks /^password/i
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Password contains a common pattern");
        });
    });

    describe("generateSecurePassword", () => {
        it("should generate unique passwords of correct length", () => {
            const p1 = generateSecurePassword(16);
            const p2 = generateSecurePassword(16);

            expect(p1.length).toBe(16);
            expect(p1).not.toBe(p2);

            // Should pass validation logic (mostly)
            // Note: Validation might fail if generated password accidentally matches a pattern (unlikely)
            // or if we strictly validate length.
            const validation = validatePasswordStrength(p1);
            expect(validation.valid).toBe(true);
        });
    });

    describe("needsRehash", () => {
        it("should return true for legacy hashes", () => {
            expect(needsRehash("$2b$10$legacy")).toBe(true);
        });

        it("should return false for argon2id", () => {
            expect(needsRehash("$argon2id$v=19$...")).toBe(false);
        });
    });
});
