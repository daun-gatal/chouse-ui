/**
 * Minimal ambient types for `nodemailer`.
 *
 * nodemailer ships no bundled `.d.ts`, and we deliberately do NOT add
 * `@types/nodemailer` to package.json: CI runs `bun install` with a frozen
 * lockfile, so a new dependency without a regenerated `bun.lock` would fail the
 * install step. This shim covers the small surface our optional email-delivery
 * path actually uses (`createTransport(...).sendMail(...)`) and is exactly the
 * fallback the compiler recommends for TS7016.
 */
declare module "nodemailer" {
  interface SendMailOptions {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  }
  interface Transporter {
    sendMail(mail: SendMailOptions): Promise<unknown>;
  }
  interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user?: string; pass?: string };
  }
  function createTransport(opts?: TransportOptions): Transporter;
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
  export { createTransport };
}
