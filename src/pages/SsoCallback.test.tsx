/**
 * Tests for SsoCallback page
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
// --- mock the rbac store module ---
const mockCompleteSsoLogin = vi.fn();

vi.mock("@/stores", () => ({
  useRbacStore: (selector: (s: { completeSsoLogin: typeof mockCompleteSsoLogin }) => unknown) =>
    selector({ completeSsoLogin: mockCompleteSsoLogin }),
}));

// --- mock log so log.error doesn't blow up ---
vi.mock("@/lib/log", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are registered
import SsoCallback from "./SsoCallback";

// Helper: render SsoCallback at a given URL and expose the router's current
// location so tests can assert where navigation landed.
function renderAt(search: string) {
  let capturedLocation: { pathname: string; search: string } | null = null;

  const LocationCapture = () => {
    capturedLocation = useLocation();
    return null;
  };

  const result = render(
    <MemoryRouter initialEntries={[`/auth/sso/callback${search}`]}>
      <Routes>
        <Route path="/auth/sso/callback" element={<SsoCallback />} />
        <Route path="*" element={<LocationCapture />} />
      </Routes>
    </MemoryRouter>,
  );

  return {
    ...result,
    getLocation: () => capturedLocation,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SsoCallback", () => {
  it("happy path: calls completeSsoLogin with the full query string and navigates to returned path", async () => {
    mockCompleteSsoLogin.mockResolvedValueOnce("/fleet");

    const { getLocation } = renderAt("?code=c1&state=s1");

    await waitFor(() => {
      expect(mockCompleteSsoLogin).toHaveBeenCalledWith("code=c1&state=s1");
    });

    await waitFor(() => {
      expect(mockCompleteSsoLogin).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(getLocation()?.pathname).toBe("/fleet");
    });
  });

  it("preserves extra IdP params (iss) in the forwarded query string", async () => {
    mockCompleteSsoLogin.mockResolvedValueOnce("/");

    renderAt("?code=c1&state=s1&iss=https%3A%2F%2Faccounts.google.com");

    await waitFor(() => {
      expect(mockCompleteSsoLogin).toHaveBeenCalledWith(
        "code=c1&state=s1&iss=https%3A%2F%2Faccounts.google.com",
      );
    });
  });

  it("IdP error: shows error_description and back-to-login link, does NOT call completeSsoLogin", async () => {
    renderAt("?error=access_denied&error_description=Denied");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Denied");
    expect(screen.getByRole("link", { name: /back to login/i })).toBeDefined();
    expect(mockCompleteSsoLogin).not.toHaveBeenCalled();
  });

  it("failure: shows rejection message when completeSsoLogin rejects", async () => {
    mockCompleteSsoLogin.mockRejectedValueOnce(
      new Error("Sign-in state mismatch. Please try again."),
    );

    renderAt("?code=c1&state=s1");

    expect(
      await screen.findByText("Sign-in state mismatch. Please try again."),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: /back to login/i })).toBeDefined();
  });

  it("missing params: shows error when code or state is absent, does NOT call completeSsoLogin", async () => {
    renderAt("?code=c1");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.toLowerCase()).toMatch(/missing sign-in parameters/);
    expect(screen.getByRole("link", { name: /back to login/i })).toBeDefined();
    expect(mockCompleteSsoLogin).not.toHaveBeenCalled();
  });

  it("redirect guard: navigates to '/' when completeSsoLogin resolves an external URL", async () => {
    mockCompleteSsoLogin.mockResolvedValueOnce("https://evil.com");

    const { getLocation } = renderAt("?code=c1&state=s1");

    await waitFor(() => {
      expect(mockCompleteSsoLogin).toHaveBeenCalledTimes(1);
    });

    // The navigate call should have been to '/' (safe fallback), not the external URL.
    await waitFor(() => {
      const loc = getLocation();
      // After navigation the MemoryRouter is at '/' — the LocationCapture's
      // pathname should be '/'.
      expect(loc?.pathname).toBe("/");
    });
  });

  it("StrictMode: completeSsoLogin is called exactly once despite double-invoke", async () => {
    mockCompleteSsoLogin.mockResolvedValueOnce("/fleet");

    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={["/auth/sso/callback?code=c1&state=s1"]}>
          <Routes>
            <Route path="/auth/sso/callback" element={<SsoCallback />} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(mockCompleteSsoLogin).toHaveBeenCalledTimes(1);
    });
  });
});
