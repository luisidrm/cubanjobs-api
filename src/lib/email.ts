import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Resend's shared sandbox sender — works with zero setup, but only delivers
// to the email address on the Resend account itself. Swap EMAIL_FROM once a
// sending domain is verified; no code change needed.
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Cuban Jobs <onboarding@resend.dev>";

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, html });
  if (error) {
    throw new Error(`Failed to send email via Resend: ${error.message}`);
  }
}

/** Builds a link back into the app for emailed actions (password reset, email verification). */
export function buildAppLink(path: string, params: Record<string, string>): string {
  const appDomain = process.env.APP_DOMAIN ?? "http://localhost:8081";
  const query = new URLSearchParams(params).toString();
  return `${appDomain}${path}?${query}`;
}
