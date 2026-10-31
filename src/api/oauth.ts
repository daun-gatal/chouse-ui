/**
 * Signing agents in to MCP (ADR 0028 §4, §5): the consent page's sign-in
 * request and decision, and each person's connected agents.
 */

import type { AiActionTier, AiToolkit } from "./aiActions";
import { api } from "./client";
import type { PatWritePolicy } from "./rbac";

export interface OAuthSignInRequest {
  request: { id: string; expiresAt: number };
  client: {
    id: string;
    /** The agent's own name for itself: unverified. */
    name: string;
    status: "allowed" | "pending" | "blocked";
    /** The host (or app link) the browser returns to: the part that can be trusted. */
    returnsTo: string;
    clientUri: string | null;
  };
  user: { email: string; username: string };
  /** Without ai:act an agent only reads, whatever is picked. */
  canAct: boolean;
  ceiling: { toolkits: AiToolkit[]; maxTier: AiActionTier };
  defaults: PatWritePolicy;
  dayChoices: number[];
  defaultDays: number;
}

export interface OAuthDecision {
  /** Where to send the browser: back to the agent with a code, or with access_denied. */
  redirectUrl: string;
}

export interface ConnectedApp {
  id: string;
  clientId: string;
  clientName: string;
  clientStatus: "allowed" | "pending" | "blocked";
  returnsTo: string | null;
  createdAt: number | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  policy: PatWritePolicy;
}

export function getSignInRequest(id: string): Promise<OAuthSignInRequest> {
  return api.get<OAuthSignInRequest>(`/oauth/requests/${encodeURIComponent(id)}`);
}

export function approveSignIn(id: string, policy: PatWritePolicy, days: number): Promise<OAuthDecision> {
  return api.post<OAuthDecision>(`/oauth/requests/${encodeURIComponent(id)}/approve`, { policy, days });
}

export function denySignIn(id: string): Promise<OAuthDecision> {
  return api.post<OAuthDecision>(`/oauth/requests/${encodeURIComponent(id)}/deny`);
}

export function listConnectedApps(): Promise<ConnectedApp[]> {
  return api.get<{ grants: ConnectedApp[] }>("/oauth/grants").then((data) => data.grants);
}

export function revokeConnectedApp(id: string): Promise<void> {
  return api.delete<void>(`/oauth/grants/${encodeURIComponent(id)}`);
}
