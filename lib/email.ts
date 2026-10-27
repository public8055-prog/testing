import nodemailer, { type Transporter } from "nodemailer";

/** Cached per process (and per dev-server recompile) so Gmail connections are reused across requests. */
const cache = globalThis as typeof globalThis & { urbanKareMailer?: Transporter; urbanKareMailerUri?: string };

export function smtpConfigured() {
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return false;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) return false;
  const port = Number(process.env.SMTP_PORT || 465);
  return Number.isInteger(port) && port > 0 && port < 65536;
}

function mailer() {
  const host = process.env.SMTP_HOST!, port = Number(process.env.SMTP_PORT || 465), user = process.env.SMTP_USER!, pass = process.env.SMTP_PASS!;
  const uri = `${user}:${host}:${port}`;
  if (cache.urbanKareMailer && cache.urbanKareMailerUri === uri) return cache.urbanKareMailer;
  cache.urbanKareMailer?.close(); // transporter.close() is synchronous; pooled sockets are drained.
  cache.urbanKareMailer = nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" },
  });
  cache.urbanKareMailerUri = uri;
  return cache.urbanKareMailer;
}

export function fromAddress() {
  const user = process.env.SMTP_USER || process.env.EMAIL_FROM || "", name = process.env.EMAIL_FROM_NAME || "";
  if (name && /^[^\n\r<>,]{1,80}$/.test(name)) return `${name} <${user}>`;
  return user;
}

/** Returns true when Gmail accepted the message; false means "UI keeps saying recovery unavailable" style fallbacks apply. */
export async function sendEmail(options: { to: string; subject: string; text: string; replyTo?: string }): Promise<boolean> {
  if (!smtpConfigured()) return false;
  const transport = mailer();
  const from = fromAddress();
  try {
    await transport.sendMail({ from, to: options.to, subject: options.subject, text: options.text, replyTo: options.replyTo });
    return true;
  } catch (error) {
    // A rejected SMTP credential should be loud in server logs; the UI never shows addresses.
    console.error("Email delivery failed:", error instanceof Error ? error.name : "UnknownError");
    return false;
  }
}
