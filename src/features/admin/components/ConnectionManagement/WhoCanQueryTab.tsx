/**
 * The Who can query tab of the connection panel. A role ceiling shows its
 * role map, a personal connection its person links, a shared login the data
 * access policies that decide what people see. A super admin edits the map
 * and the links; everyone else sees the counts.
 */

import type { MutableRefObject, ReactElement } from "react";
import { Link } from "react-router";

import { IDENTITY_MODE_CEILING, IDENTITY_MODE_PERSONAL, IDENTITY_MODE_SHARED, identityKind } from "@/api/connectionIdentity";
import type { ClickHouseConnection, ConnectionReadiness } from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HELP_CLASS, SECONDARY_BUTTON_CLASS } from "./formStyles";
import { askWhom, Note } from "./panelParts";
import { PersonLinks } from "./PersonLinks";
import { RoleMapEditor } from "./RoleMapEditor";

const POLICIES_PATH = "/admin/data-access";

interface WhoCanQueryTabProps {
  connection: ClickHouseConnection;
  superAdmin: boolean;
  /** The viewer's CHouse role names. */
  viewerRoles: readonly string[];
  /** The role map or a link changed: the connection's readiness is stale. */
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  saveRef: MutableRefObject<(() => Promise<boolean>) | null>;
  onFinish: () => void;
}

function PoliciesLink({ children }: { children: string }): ReactElement {
  return (
    <Link to={POLICIES_PATH} className="font-medium text-brand underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

function policiesLine(count: number): string {
  return `${count} data access ${count === 1 ? "policy applies" : "policies apply"} to this connection.`;
}

/** The readiness in words, for someone who sees counts only. */
function countsLines(kind: string, readiness: ConnectionReadiness): string[] {
  const lines: string[] = [];
  if (kind === IDENTITY_MODE_CEILING && readiness.roles) {
    const { mapped, total, peopleRefused } = readiness.roles;
    lines.push(`${mapped} of ${total} CHouse ${total === 1 ? "role is" : "roles are"} mapped to a ClickHouse role.`);
    if (peopleRefused > 0) lines.push(`${peopleRefused} ${peopleRefused === 1 ? "person can't" : "people can't"} query yet.`);
  }
  if (kind === IDENTITY_MODE_PERSONAL && readiness.links) {
    const { active, pending, other } = readiness.links;
    lines.push(`${active} active ${active === 1 ? "link" : "links"}, ${pending} waiting for GRANT${other > 0 ? `, ${other} suspended or disabled` : ""}.`);
  }
  return lines;
}

export function WhoCanQueryTab({ connection, superAdmin, viewerRoles, onChanged, onDirtyChange, saveRef, onFinish }: WhoCanQueryTabProps): ReactElement {
  const kind = identityKind(connection.identityMode);
  const readiness = connection.readiness ?? null;
  const refusing = readiness?.state === "refusing";

  const footer = (
    <div className="flex justify-start border-t border-ink-500 pt-4">
      <Button type="button" variant="outline" onClick={onFinish} className={SECONDARY_BUTTON_CLASS}>
        Finish later
      </Button>
    </div>
  );

  if (kind === "unknown") {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <Note tone="bad" title="Nobody can query this connection">
          <p>This build does not know its kind, so it refuses every request until it is switched on the ClickHouse login tab.</p>
        </Note>
        {footer}
      </div>
    );
  }

  if (kind === IDENTITY_MODE_SHARED) {
    const policies = readiness?.policies ?? null;
    return (
      <div className="flex min-w-0 flex-col gap-5">
        {policies === null ? (
          <Note tone="info" title="CHouse data access policies decide what each person sees">
            <p>Everyone runs as {connection.username}.</p>
          </Note>
        ) : policies > 0 ? (
          <Note tone="ok" title="Ready" role="status">
            <p>Everyone runs as {connection.username}. CHouse data access policies decide what each person sees.</p>
            <p>{policiesLine(policies)}</p>
          </Note>
        ) : (
          <Note tone="warn" title="No data access policy yet">
            <p>Everyone runs as {connection.username}, and people other than admins see no tables until a data access policy covers this connection.</p>
          </Note>
        )}
        <Link to={POLICIES_PATH} className={cn(SECONDARY_BUTTON_CLASS, "inline-flex items-center self-start border")}>
          Data access policies
        </Link>
        {footer}
      </div>
    );
  }

  const contactLine = `Only a super admin can change who can query ${kind === IDENTITY_MODE_CEILING ? "a role-ceiling" : "a personal"} connection. Ask ${askWhom(connection.accessContact)}.`;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {refusing && (
        <Note tone="bad" title="Nobody can query while the login fails its checks">
          <p>Fix the login on the ClickHouse login tab. What you prepare here takes effect once it passes.</p>
        </Note>
      )}

      {!superAdmin ? (
        <>
          {readiness && countsLines(kind, readiness).length > 0 && (
            <ul className="flex flex-col gap-1 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5 text-[12px] leading-[1.5] text-paper-muted">
              {countsLines(kind, readiness).map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          <Note tone="lock" title={contactLine} />
        </>
      ) : kind === IDENTITY_MODE_CEILING ? (
        <>
          <RoleMapEditor connectionId={connection.id} viewerRoles={viewerRoles} onSaved={onChanged} onDirtyChange={onDirtyChange} saveRef={saveRef} />
          <p className={cn(HELP_CLASS, "leading-[1.5]")}>
            The ClickHouse roles you map must be granted to the login: the script on the ClickHouse login tab updates with them. Mapping a role means only a super admin can assign that CHouse role from now on.
          </p>
        </>
      ) : (
        <>
          {readiness?.state === "none" && (
            <Note tone="warn" title="Nobody can query this connection yet">
              <p>A person can query once they're linked to their own ClickHouse user and your admin has run the GRANT for that link. That includes you.</p>
            </Note>
          )}
          <PersonLinks connection={connection} onChanged={onChanged} />
        </>
      )}

      {kind === IDENTITY_MODE_CEILING && readiness?.policies === 0 && (
        <p role="note" className="text-[12px] leading-[1.5] text-amber-800 dark:text-amber-200">
          No data access policy yet: people other than admins see no tables. <PoliciesLink>Data access policies</PoliciesLink>
        </p>
      )}

      {footer}
    </div>
  );
}
