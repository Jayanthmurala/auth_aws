import nodemailer from "nodemailer";
import mjml2html from "mjml";
import { env } from "../config/env";
import { resetPasswordMjml, verifyEmailMjml } from "./templates";

let transporterPromise: Promise<nodemailer.Transporter> | null = null;

async function createTransporter(): Promise<nodemailer.Transporter> {
  if (env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER || env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    } as any);
  }
  // Dev fallback: Ethereal test account
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
}

async function getTransporter() {
  if (!transporterPromise) transporterPromise = createTransporter();
  return transporterPromise;
}

function render(mjml: string) {
  const { html, errors } = mjml2html(mjml, { validationLevel: "soft" });
  if (errors && errors.length) {
    // eslint-disable-next-line no-console
    console.warn("MJML render warnings:", errors);
  }
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { html, text };
}

export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }) {
  const t = await getTransporter();
  const info = await t.sendMail({
    from: env.EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info);
  return { messageId: info.messageId, previewUrl };
}

export async function sendVerificationEmail(to: string, actionUrl: string) {
  const { html, text } = render(
    verifyEmailMjml({ appName: env.APP_NAME, actionUrl, supportEmail: env.SUPPORT_EMAIL })
  );
  return sendMail({ to, subject: `Verify your ${env.APP_NAME} email`, html, text });
}

export async function sendPasswordResetEmail(to: string, actionUrl: string) {
  const { html, text } = render(
    resetPasswordMjml({ appName: env.APP_NAME, actionUrl, supportEmail: env.SUPPORT_EMAIL })
  );
  return sendMail({ to, subject: `Reset your ${env.APP_NAME} password`, html, text });
}
