/**
 * Email rendering: an HTML card in the alert layout CHouse always sent, with
 * the plain-text part people and filters read.
 */

import { escapeHtml, plainText, SEVERITY_COLOR } from "../text";
import type { NotifyMessage } from "../types";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  to: string;
}

export function emailConfig(c: Record<string, unknown>): EmailConfig {
  return {
    host: String(c.host ?? "smtp.gmail.com"),
    port: Number(c.port) || 465,
    secure: c.secure !== undefined ? Boolean(c.secure) : true,
    user: String(c.user ?? ""),
    password: String(c.password ?? ""),
    from: String(c.from ?? c.user ?? ""),
    to: String(c.to ?? ""),
  };
}

function paragraphs(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

export function renderEmailHtml(message: NotifyMessage): string {
  const color = SEVERITY_COLOR[message.severity ?? "info"];
  const parts: string[] = [];
  if (message.text) parts.push(`<div style="font-size:14px;color:#374151;line-height:1.5">${paragraphs(message.text)}</div>`);
  if (message.facts?.length) {
    const rows = message.facts
      .map((f) => `<tr><td style="padding:3px 12px 3px 0;color:#6b7280;font-size:13px;vertical-align:top">${escapeHtml(f.label)}</td><td style="padding:3px 0;color:#111827;font-size:13px">${escapeHtml(f.value)}</td></tr>`)
      .join("");
    parts.push(`<table style="margin-top:12px;border-collapse:collapse">${rows}</table>`);
  }
  for (const section of message.sections ?? []) {
    parts.push(`<div style="margin-top:12px;font-size:13px;color:#374151;line-height:1.5">${section.title ? `<strong style="color:#111827">${escapeHtml(section.title)}</strong><br>` : ""}${paragraphs(section.text)}</div>`);
  }
  if (message.detail) {
    parts.push(`<div style="margin-top:12px;padding:10px 12px;background:#f9fafb;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#374151;word-break:break-all">${paragraphs(message.detail)}</div>`);
  }
  if (message.links?.length) {
    const links = message.links.map((l) => `<a href="${escapeHtml(l.url)}" style="color:#2563eb;margin-right:16px">${escapeHtml(l.label)}</a>`).join("");
    parts.push(`<div style="margin-top:14px;font-size:13px">${links}</div>`);
  }
  if (message.footer) parts.push(`<div style="margin-top:16px;color:#9ca3af;font-size:11px">${escapeHtml(message.footer)}</div>`);
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#fff">
    <div style="background:${color};color:#fff;padding:14px 18px;font-weight:600;font-size:15px">${escapeHtml(message.title)}</div>
    <div style="padding:18px">${parts.join("")}</div>
  </div>`;
}

export async function sendEmail(config: Record<string, unknown>, message: NotifyMessage): Promise<void> {
  const email = emailConfig(config);
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    auth: { user: email.user, pass: email.password },
  });
  await transport.sendMail({
    from: email.from,
    to: email.to,
    subject: message.emailSubject ?? message.title,
    text: plainText(message),
    html: renderEmailHtml(message),
  });
}
