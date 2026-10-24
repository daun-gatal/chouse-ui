
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { corsMiddleware } from "./cors";

describe("CORS Middleware", () => {
    let mockContext: any;
    let mockNext: any;

    beforeEach(() => {
        mockContext = {
            req: {
                header: mock((name: string) => name === "Origin" ? "http://example.com" : null),
                path: "/api/data",
                method: "GET"
            },
            header: mock(),
            json: mock(),
            body: mock(),
        };
        mockNext = mock(async () => { });
    });

    it("should allow request if origin matches string", async () => {
        const middleware = corsMiddleware({ origin: "http://example.com" });
        await middleware(mockContext, mockNext);

        expect(mockContext.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "http://example.com");
        expect(mockNext).toHaveBeenCalled();
    });

    it("should allow request if origin matches array", async () => {
        const middleware = corsMiddleware({ origin: ["http://other.com", "http://example.com"] });
        await middleware(mockContext, mockNext);

        expect(mockContext.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "http://example.com");
        expect(mockNext).toHaveBeenCalled();
    });

    it("should allow request from subdomain if wildcard used", async () => {
        const middleware = corsMiddleware({ origin: ["*.example.com"] });
        mockContext.req.header.mockImplementation((name: string) => name === "Origin" ? "http://sub.example.com" : null);

        await middleware(mockContext, mockNext);

        expect(mockContext.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "http://sub.example.com");
    });

    it("should block request in strict mode if origin not allowed", async () => {
        const middleware = corsMiddleware({
            origin: ["http://trusted.com"],
            strictMode: true
        });

        await middleware(mockContext, mockNext); // Origin is example.com

        expect(mockContext.json).toHaveBeenCalled();
        expect(mockNext).not.toHaveBeenCalled();

        // Verify 403 status code
        const args = mockContext.json.mock.calls[0];
        expect(args[1]).toBe(403);
    });

    it("should allow bypass paths in strict mode", async () => {
        const middleware = corsMiddleware({
            origin: ["http://trusted.com"],
            strictMode: true,
            bypassPaths: ["/api/health"]
        });

        mockContext.req.path = "/api/health";
        await middleware(mockContext, mockNext);

        // Should proceed even if origin doesn't match
        expect(mockNext).toHaveBeenCalled();
    });

    it("should handle preflight OPTIONS requests", async () => {
        const middleware = corsMiddleware({ origin: "http://example.com" });
        mockContext.req.method = "OPTIONS";

        await middleware(mockContext, mockNext);

        expect(mockContext.header).toHaveBeenCalledWith("Access-Control-Allow-Methods", expect.anything());
        expect(mockContext.body).toHaveBeenCalledWith(null, 204);
        expect(mockNext).not.toHaveBeenCalled(); // Should return early
    });

    it("never allows credentials with a wildcard origin", async () => {
        const middleware = corsMiddleware({ origin: "*", credentials: true });
        mockContext.req.header.mockImplementation((name: string) => name === "Origin" ? "https://attacker.example" : null);

        await middleware(mockContext, mockNext);

        expect(mockContext.header).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
        expect(mockContext.header).not.toHaveBeenCalledWith("Access-Control-Allow-Origin", "https://attacker.example");
        expect(mockContext.header).not.toHaveBeenCalledWith("Access-Control-Allow-Credentials", "true");
    });

    it("still allows credentials for an explicitly listed origin", async () => {
        const middleware = corsMiddleware({ origin: ["http://example.com"], credentials: true });

        await middleware(mockContext, mockNext);

        expect(mockContext.header).toHaveBeenCalledWith("Access-Control-Allow-Credentials", "true");
    });

    it("does not let a wildcard subdomain match a lookalike domain", async () => {
        const middleware = corsMiddleware({ origin: ["*.example.com"], strictMode: true });
        mockContext.req.header.mockImplementation((name: string) => name === "Origin" ? "https://evilexample.com" : null);

        await middleware(mockContext, mockNext);

        expect(mockNext).not.toHaveBeenCalled();
        expect(mockContext.json.mock.calls[0][1]).toBe(403);
    });
});
