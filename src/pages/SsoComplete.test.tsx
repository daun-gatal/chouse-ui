/**
 * Tests for SsoComplete page (SAML browser-POST handoff)
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// --- mock the rbac store module ---
const mockCompleteSamlLogin = vi.fn();

vi.mock("@/stores", () => ({
  useRbacStore: (selector: (s: { completeSamlLogin: typeof mockCompleteSamlLogin }) => unknown) =>
    selector({ completeSamlLogin: mockCompleteSamlLogin }),
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
import SsoComplete from "./SsoComplete";

// Helper: render SsoComplete at a given URL and expose the router's current
// location so tests can assert where navigation landed.
function renderAt(search: string) {
  let capturedLocation: { pathname: string; search: string } | null = null;

  const LocationCapture = () => {
    capturedLocation = useLocation();
    return null;
  };

  const result = render(
    <MemoryRouter initialEntries={[`/login/sso-complete${search}`]}>
      <Routes>
        <Route path="/login/sso-complete" element={<SsoComplete />} />
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

describe("SsoComplete", () => {
  it("happy path: exchanges the code and navigates to the returned path", async () => {
    mockCompleteSamlLogin.mockResolvedValueOnce("/fleet");

    const { getLocation } = renderAt("?code=otc-123");

    await waitFor(() => {
      expect(mockCompleteSamlLogin).toHaveBeenCalledWith("otc-123");
    });

    await waitFor(() => {
      expect(mockCompleteSamlLogin).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(getLocation()?.pathname).toBe("/fleet");
    });
  });

  it("missing code: shows error and back-to-login link, does NOT exchange", async () => {
    renderAt("");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.toLowerCase()).toMatch(/missing sign-in code/);
    expect(screen.getByRole("link", { name: /back to login/i })).toBeDefined();
    expect(mockCompleteSamlLogin).not.toHaveBeenCalled();
  });

  it("failure: shows rejection message when the exchange rejects", async () => {
    mockCompleteSamlLogin.mockRejectedValueOnce(
      new Error("Sign-in code expired. Please try again."),
    );

    renderAt("?code=otc-123");

    expect(
      await screen.findByText("Sign-in code expired. Please try again."),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: /back to login/i })).toBeDefined();
  });

  it("redirect guard: navigates to '/' when the exchange resolves an external URL", async () => {
    mockCompleteSamlLogin.mockResolvedValueOnce("https://evil.com");

    const { getLocation } = renderAt("?code=otc-123");

    await waitFor(() => {
      expect(mockCompleteSamlLogin).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(getLocation()?.pathname).toBe("/");
    });
  });

  it("StrictMode: the exchange is called exactly once despite double-invoke", async () => {
    mockCompleteSamlLogin.mockResolvedValueOnce("/fleet");

    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={["/login/sso-complete?code=otc-123"]}>
          <Routes>
            <Route path="/login/sso-complete" element={<SsoComplete />} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(mockCompleteSamlLogin).toHaveBeenCalledTimes(1);
    });
  });
});
