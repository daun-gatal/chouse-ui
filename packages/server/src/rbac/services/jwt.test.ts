
import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    extractTokenFromHeader,
    generateTokenPair
} from "./jwt";
import { SignJWT } from "jose";

describe("JWT Service", () => {
    const mockUser = {
        sub: "user-123",
        email: "test@example.com",
        username: "testuser",
        roles: ["viewer"],
        permissions: ["read"],
        sessionId: "sess-123"
    };

    describe("generateAccessToken", () => {
        it("should generate a valid JWT", async () => {
            const token = await generateAccessToken(mockUser);
            expect(token).toBeString();
            expect(token.split('.')).toHaveLength(3);
        });
    });

    describe("verifyAccessToken", () => {
        it("should verify a valid token", async () => {
            const token = await generateAccessToken(mockUser);
            const payload = await verifyAccessToken(token);

            expect(payload.sub).toBe(mockUser.sub);
            expect(payload.type).toBe("access");
        });

        it("should reject invalid token", async () => {
            expect(verifyAccessToken("invalid.token.here")).rejects.toThrow();
        });

        it("should reject refresh token", async () => {
            const token = await generateRefreshToken(mockUser.sub, mockUser.sessionId);
            expect(verifyAccessToken(token)).rejects.toThrow("Invalid token type");
        });
    });

    describe("verifyRefreshToken", () => {
        it("should verify valid refresh token", async () => {
            const token = await generateRefreshToken(mockUser.sub, mockUser.sessionId);
            const payload = await verifyRefreshToken(token);

            expect(payload.sub).toBe(mockUser.sub);
            expect(payload.type).toBe("refresh");
        });

        it("should reject access token", async () => {
            const token = await generateAccessToken(mockUser);
            expect(verifyRefreshToken(token)).rejects.toThrow("Invalid token type");
        });
    });

    describe("generateTokenPair", () => {
        it("should return access and refresh tokens", async () => {
            const pair = await generateTokenPair(
                mockUser.sub,
                mockUser.email,
                mockUser.username,
                mockUser.roles,
                mockUser.permissions,
                mockUser.sessionId
            );

            expect(pair.accessToken).toBeString();
            expect(pair.refreshToken).toBeString();
            expect(pair.expiresIn).toBeNumber();
        });
    });

    describe("extractTokenFromHeader", () => {
        it("should extract bearer token", () => {
            expect(extractTokenFromHeader("Bearer abc")).toBe("abc");
            expect(extractTokenFromHeader("bearer abc")).toBe("abc");
        });

        it("should return null for invalid format", () => {
            expect(extractTokenFromHeader("Basic abc")).toBeNull();
            expect(extractTokenFromHeader("abc")).toBeNull();
            expect(extractTokenFromHeader("")).toBeNull();
            expect(extractTokenFromHeader(undefined)).toBeNull();
        });
    });
});
