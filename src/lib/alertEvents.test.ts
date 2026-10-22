import { describe, expect, it } from "vitest";

import { eventSummary } from "./alertEvents";

describe("eventSummary", () => {
  it("shows a panel alert's title and text", () => {
    expect(eventSummary(JSON.stringify({ source: "dashboard_panel_alert", title: "🔴 Lag", text: "Consumer lag on dashboard Kafka: last of lag is 9" }))).toBe("🔴 Lag — Consumer lag on dashboard Kafka: last of lag is 9");
  });

  it("shows a dashboard report's title and text", () => {
    expect(eventSummary(JSON.stringify({ source: "dashboard_report", title: "📊 Daily shop failed", text: "PUBLIC_BASE_URL is not set" }))).toBe("📊 Daily shop failed — PUBLIC_BASE_URL is not set");
  });

  it("shows other payloads as recorded", () => {
    expect(eventSummary("Node memory at 93%")).toBe("Node memory at 93%");
    expect(eventSummary('{"source":"fleet","x":1}')).toBe('{"source":"fleet","x":1}');
    expect(eventSummary("{not json")).toBe("{not json");
    expect(eventSummary(null)).toBe("—");
  });
});
