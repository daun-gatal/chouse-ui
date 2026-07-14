import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Doctor from "./Doctor";

const mocks = vi.hoisted(() => ({
  fetchDoctorEnabled: vi.fn(),
  fetchDoctorModels: vi.fn(),
  fetchDoctorReports: vi.fn(),
  fetchDoctorReport: vi.fn(),
  runDoctorScan: vi.fn(),
  deleteDoctorReports: vi.fn(),
  deleteAllDoctorReports: vi.fn(),
}));

vi.mock("@/api/fleet", () => mocks);

vi.mock("@/hooks/useFleetMetrics", () => ({
  useFleetConnections: () => ({
    data: [
      { id: "node-1", name: "Node 1", isActive: true },
      { id: "node-2", name: "Node 2", isActive: true },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/stores", () => ({
  RBAC_PERMISSIONS: { DOCTOR_RUN: "doctor:run" },
  useRbacStore: () => ({ hasPermission: () => true }),
}));

vi.mock("@/features/fleet/components/DoctorReportView", () => ({ default: () => null }));
vi.mock("@/features/fleet/components/DoctorHistoryList", () => ({ default: () => null }));
vi.mock("@/features/fleet/components/DoctorScheduleDialog", () => ({ default: () => null }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderDoctor(): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/doctor?guide=doctor-run"]}>
        <Routes>
          <Route path="/doctor" element={<Doctor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Doctor onboarding targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchDoctorModels.mockResolvedValue([
      { id: "model-1", label: "Model 1", model: "model-1", provider: "test", isDefault: true },
      { id: "model-2", label: "Model 2", model: "model-2", provider: "test", isDefault: false },
    ]);
    mocks.fetchDoctorReports.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("keeps run and schedule anchors mounted while async controls appear", async () => {
    const enabledRequest = deferred<{ enabled: boolean }>();
    mocks.fetchDoctorEnabled.mockReturnValue(enabledRequest.promise);
    renderDoctor();

    const runAnchor = document.querySelector('[data-onboarding-id="doctor-run"]');
    const scheduleAnchor = document.querySelector('[data-onboarding-id="doctor-schedule"]');
    const runButton = runAnchor?.closest("button");
    const scheduleButton = scheduleAnchor?.closest("button");
    if (!(runButton instanceof HTMLButtonElement) || !(scheduleButton instanceof HTMLButtonElement)) {
      throw new Error("Doctor guide controls did not render");
    }
    const stableActions = runButton.parentElement;
    if (!(stableActions instanceof HTMLDivElement)) throw new Error("Doctor guide controls are not grouped");

    expect(stableActions.classList.contains("order-first")).toBe(true);
    expect(stableActions.classList.contains("basis-full")).toBe(true);
    expect(scheduleButton.disabled).toBe(true);

    await act(async () => enabledRequest.resolve({ enabled: true }));
    await waitFor(() => expect(scheduleButton.disabled).toBe(false));

    expect(document.querySelector('[data-onboarding-id="doctor-run"]')).toBe(runAnchor);
    expect(document.querySelector('[data-onboarding-id="doctor-schedule"]')).toBe(scheduleAnchor);
  });
});
