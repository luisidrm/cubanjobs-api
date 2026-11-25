import { Resend } from "resend";
import { logger } from "./logger";

const resend = new Resend(process.env.RESEND_API_KEY);

// Resend's shared sandbox sender — works with zero setup, but only delivers
// to the email address on the Resend account itself. Swap EMAIL_FROM once a
// sending domain is verified; no code change needed.
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Brujula <onboarding@resend.dev>";

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

// Domains reserved for testing and documentation (RFC 2606 / 6761): no mailbox can ever exist there.
const RESERVED_DOMAIN = /@(?:[^@]+\.)?(?:example\.(?:com|net|org)|test|example|invalid|localhost)$/i;

/** True for addresses used by test accounts, which a mail provider would only reject. */
export function isUndeliverableTestAddress(to: string): boolean {
  return RESERVED_DOMAIN.test(to.trim());
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  if (isUndeliverableTestAddress(to)) {
    logger.info(`Email "${subject}" not sent: the recipient is a reserved test domain`);
    return;
  }
  const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, html });
  if (error) {
    throw new Error(`Failed to send email via Resend: ${error.message}`);
  }
}

/**
 * Builds a link back into the app for emailed actions (password reset, email
 * verification). `platform` comes from the `x-platform` header the caller
 * sent on the original request (threaded through via SuperTokens'
 * userContext — see supertokens.ts) — defaults to native/APP_DOMAIN so
 * existing mobile behavior is unchanged if the header is ever missing.
 */
export function buildAppLink(
  path: string,
  params: Record<string, string>,
  platform?: "web" | "native"
): string {
  const domain =
    platform === "web"
      ? (process.env.WEBSITE_DOMAIN ?? "http://localhost:3000")
      : (process.env.APP_DOMAIN ?? "http://localhost:8081");
  const query = new URLSearchParams(params).toString();
  return `${domain}${path}?${query}`;
}
