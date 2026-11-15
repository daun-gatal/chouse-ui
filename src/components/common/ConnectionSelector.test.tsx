import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SharedLogin } from "./ConnectionSelector";

afterEach(cleanup);

describe("SharedLogin", () => {
  it("names the shared ClickHouse user everyone's statements run as", () => {
    const { container } = render(<SharedLogin username="chouse" identityMode="shared" />);
    expect(container.textContent).toBe("Shared login chouse");
    expect(container.querySelector("span")?.getAttribute("title")).toBe(
      "Everyone using this connection in CHouse sends statements as this ClickHouse user.",
    );
  });

  it("reads a connection without a kind as a shared login", () => {
    const { container } = render(<SharedLogin username="chouse" />);
    expect(container.textContent).toBe("Shared login chouse");
  });

  it("says a role ceiling limits the person to their ClickHouse role", () => {
    const { container } = render(<SharedLogin username="chouse_login" identityMode="shared_ceiling" />);
    expect(container.textContent).toBe("Shared login chouse_login, limited to your ClickHouse role");
    expect(container.querySelector("span")?.getAttribute("title")).toBe(
      "Your statements on this connection run as this ClickHouse user, with only the ClickHouse role mapped to your CHouse role.",
    );
  });

  it("keeps the user name's case, since ClickHouse user names are case-sensitive", () => {
    const { container } = render(<SharedLogin username="ChouseLogin" identityMode="shared_ceiling" />);
    expect(container.querySelector("span span")?.className).toContain("normal-case");
    expect(container.querySelector("span span")?.textContent).toBe("ChouseLogin");
  });
});
