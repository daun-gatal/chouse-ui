import { describe, expect, it } from "bun:test";

import { classifyError, errorName } from "./errorClass";

describe("classifyError", () => {
  it("uses the trailing ClickHouse error name", () => {
    expect(errorName("Code: 241. DB::Exception: x (MEMORY_LIMIT_EXCEEDED) (version 26.5)")).toBe("MEMORY_LIMIT_EXCEEDED");
    expect(classifyError("Code: 241. DB::Exception: would use 9 GiB (MEMORY_LIMIT_EXCEEDED) (version 26.5)")).toBe("engine");
    expect(classifyError("Code: 159. DB::Exception: Timeout exceeded (TIMEOUT_EXCEEDED)")).toBe("engine");
    expect(classifyError("Code: 26. Cannot parse JSON string (CANNOT_PARSE_QUOTED_STRING)")).toBe("data");
    expect(classifyError("Code: 81. Database x does not exist (UNKNOWN_DATABASE)")).toBe("config");
    expect(classifyError("Code: 530. Cannot connect to rabbitmq:5672 (CANNOT_CONNECT_RABBITMQ)")).toBe("external");
  });

  it("treats a throwIf in a transform as a data rule failing", () => {
    expect(classifyError("Code: 395. DB::Exception: value e is not allowed: while executing 'FUNCTION throwIf(...)'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)")).toBe("data");
  });

  it("recognises external database driver errors without an error name", () => {
    const pg = 'std::exception. Code: 1001, type: pqxx::undefined_table, e.what() = ERROR:  relation "legacy" does not exist (version 26.5.7.64 (official build))';
    expect(classifyError(pg)).toBe("external");
  });

  it("does not blame the engine for an unknown error", () => {
    expect(classifyError("Code: 999. DB::Exception: something new (SOMETHING_NEW)")).toBeNull();
    expect(classifyError("")).toBeNull();
    expect(classifyError(null)).toBeNull();
  });
});
