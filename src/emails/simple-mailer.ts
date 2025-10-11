import nodemailer from "nodemailer";
import { env } from "../config/env.js";

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

// Simple HTML email templates (without MJML)
function createEmailTemplate(title: string, content: string, actionUrl?: string, actionText?: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #007bff; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <h1>${env.APP_NAME}</h1>
    </div>
    <div class="content">
        <h2>${title}</h2>
        <p>${content}</p>
        ${actionUrl && actionText ? `<a href="${actionUrl}" class="button">${actionText}</a>` : ''}
        <p>If you didn't request this, please ignore this email.</p>
    </div>
    <div class="footer">
        <p>© ${new Date().getFullYear()} ${env.APP_NAME}. All rights reserved.</p>
        <p>Need help? Contact us at ${env.SUPPORT_EMAIL}</p>
    </div>
</body>
</html>`;
}

export async function sendVerificationEmail(to: string, actionUrl: string) {
  const html = createEmailTemplate(
    'Verify Your Email',
    'Please click the button below to verify your email address and activate your account.',
    actionUrl,
    'Verify Email'
  );
  
  const text = `Verify your ${env.APP_NAME} email address by visiting: ${actionUrl}`;
  
  return sendMail({ 
    to, 
    subject: `Verify your ${env.APP_NAME} email`, 
    html, 
    text 
  });
}

export async function sendPasswordResetEmail(to: string, actionUrl: string) {
  const html = createEmailTemplate(
    'Reset Your Password',
    'You requested a password reset. Click the button below to create a new password.',
    actionUrl,
    'Reset Password'
  );
  
  const text = `Reset your ${env.APP_NAME} password by visiting: ${actionUrl}`;
  
  return sendMail({ 
    to, 
    subject: `Reset your ${env.APP_NAME} password`, 
    html, 
    text 
  });
}
