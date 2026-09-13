import { KeyRound, ShieldCheck, Settings2, ArrowUpRight } from "lucide-react";
import { Section, Container, SectionHeader, CodeBlock, Tag, SecondaryAction } from "./Section";

const SSO_REFERENCE_URL =
  "https://github.com/daun-gatal/chouse-ui/blob/main/docs/sso.md";

const OIDC_SNIPPET = `# config.yaml — minimal OIDC provider (Okta shown)
auth:
  sso:
    enabled: true
    base_url: https://chouse.your-company.com
    default_role: viewer        # role granted to new users
    auto_link_by_email: true
    providers:
      okta:
        type: oidc
        display_name: "Okta"
        issuer: https://corp.okta.com
        client_id: "..."
        client_secret: "..."
        scopes: "openid profile email"

  # Optional: turn off username/password sign-in entirely so the
  # only way in is SSO. Ignored unless a usable provider exists.
  password_login:
    enabled: false`;

const CAPABILITIES = [
  {
    icon: KeyRound,
    title: "OIDC · OAuth2 · SAML",
    body: "Standard OIDC discovery, plain OAuth2 (GitHub, custom), and SAML 2.0 — SP- and IdP-initiated.",
  },
  {
    icon: Settings2,
    title: "Config- or UI-driven",
    body: "Define providers in YAML/env (read-only, versioned) or manage them live in the admin UI. Env wins on conflict.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by default",
    body: "Secrets encrypted at rest (AES-256-GCM), JIT provisioning, role mapping, and IdP-email trust off by default.",
  },
];

export default function Sso() {
  return (
    <Section id="sso" aria-label="Single sign-on">
      <Container>
        <SectionHeader
          eyebrow="Single sign-on"
          eyebrowIndex={7}
          title="Bring your own identity provider."
          description="Wire up OIDC, OAuth2, or SAML in a few lines of config — or manage providers live from the admin UI. Optionally disable password login to require SSO."
          action={
            <SecondaryAction href={SSO_REFERENCE_URL} target="_blank" rel="noreferrer">
              Full reference
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </SecondaryAction>
          }
        />

        <div className="mt-16 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <div className="flex flex-col gap-5">
            {CAPABILITIES.map((cap) => {
              const Icon = cap.icon;
              return (
                <div
                  key={cap.title}
                  className="flex items-start gap-4 border-t border-ink-500 pt-5 first:border-t-0 first:pt-0"
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-[15px] font-semibold text-paper">{cap.title}</h3>
                    <p className="text-sm leading-relaxed text-paper-muted">{cap.body}</p>
                  </div>
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Tag variant="accent">OIDC</Tag>
              <Tag variant="accent">OAuth2</Tag>
              <Tag variant="accent">SAML 2.0</Tag>
              <Tag variant="muted">Role mapping</Tag>
              <Tag variant="muted">Auto-link by email</Tag>
            </div>

            {/* Mobile / small screens: the header action is hidden < md. */}
            <div className="md:hidden">
              <SecondaryAction href={SSO_REFERENCE_URL} target="_blank" rel="noreferrer">
                Full reference
                <ArrowUpRight className="h-4 w-4" aria-hidden />
              </SecondaryAction>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <CodeBlock language="yaml" filename="config.yaml" code={OIDC_SNIPPET} maxHeight="440px" />
            <p className="text-sm leading-relaxed text-paper-muted">
              Register{" "}
              <span className="font-mono text-paper">&lt;base_url&gt;/auth/sso/callback</span>{" "}
              as the redirect URI at your IdP. The{" "}
              <SecondaryAction
                href={SSO_REFERENCE_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-auto border-0 px-0 align-baseline text-accent hover:bg-transparent"
              >
                full reference
              </SecondaryAction>{" "}
              covers SAML, role mapping, precedence, and security notes.
            </p>
          </div>
        </div>
      </Container>
    </Section>
  );
}
