import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    // SMTP not configured yet - log instead of failing the request that triggered this.
    console.warn(`[mailer] SMTP not configured, skipping email to ${to}: ${subject}`);
    return false;
  }
  await t.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
  return true;
}
