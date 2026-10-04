/**
 * ADR 0016 §18: the pre-0016 fleet poller switch stays accepted. Setting it
 * (env or config.yaml `fleet.poller_enabled`, which the loader flattens to the
 * same env name) logs one deprecation warning and changes nothing.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";

const warn = mock();
mock.module("../../utils/logger", () => ({ logger: { warn, info: mock(), debug: mock(), error: mock() }, requestLogger: () => ({}) }));

const { warnDeprecatedConfig } = await import("./index");
const { flattenConfig } = await import("../../utils/configLoader");

describe("deprecated fleet poller config", () => {
  afterEach(() => {
    delete process.env.FLEET_POLLER_ENABLED;
    warn.mockClear();
  });

  it("is silent when the key is absent", () => {
    warnDeprecatedConfig();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once, whatever the value", () => {
    for (const value of ["true", "false"]) {
      process.env.FLEET_POLLER_ENABLED = value;
      warnDeprecatedConfig();
    }
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][1])).toContain("deprecated and ignored");
  });

  it("covers config.yaml fleet.poller_enabled, which flattens to the same key", () => {
    expect(flattenConfig({ fleet: { poller_enabled: true } })).toEqual({ FLEET_POLLER_ENABLED: "true" });
  });
});
