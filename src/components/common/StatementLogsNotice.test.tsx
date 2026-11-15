import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { STATEMENT_LOGS_PERMISSION_HINT, StatementLogsNotice } from "./StatementLogsNotice";

describe("StatementLogsNotice", () => {
  it("names what is hidden and the permission to ask for", () => {
    render(<StatementLogsNotice subject="The query timeline" />);

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("The query timeline needs a permission");
    expect(notice.textContent).toContain("query:history:view:all");
  });

  it("offers a one-line form for tight spots", () => {
    expect(STATEMENT_LOGS_PERMISSION_HINT).toBe("Needs query:history:view:all");
  });
});
