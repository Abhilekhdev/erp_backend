import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Env } from '../../config/env.validation';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string;
  bcc?: string;
  attachments?: MailAttachment[];
}

/**
 * SMTP mailer. Config keys mirror the legacy Laravel `.env` (MAIL_HOST/MAIL_PORT/MAIL_USERNAME/
 * MAIL_PASSWORD/MAIL_ENCRYPTION/MAIL_FROM_*) so the same credentials drop straight in.
 *
 * `MAIL_ENCRYPTION`: 'ssl' → implicit TLS (secure socket, usually port 465);
 * 'tls' → STARTTLS upgrade on a plain socket (usually port 587). Laravel uses the same wording.
 *
 * The transporter is created lazily and reused (pooled), so the SMTP handshake happens once
 * instead of per message.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** False when SMTP isn't configured — callers surface a clear error instead of throwing. */
  isConfigured(): boolean {
    return Boolean(this.config.get('MAIL_HOST', { infer: true }));
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = this.config.get('MAIL_HOST', { infer: true });
    const port = this.config.get('MAIL_PORT', { infer: true });
    const user = this.config.get('MAIL_USERNAME', { infer: true });
    const pass = this.config.get('MAIL_PASSWORD', { infer: true });
    const encryption = this.config.get('MAIL_ENCRYPTION', { infer: true });

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: encryption === 'ssl', // ssl = implicit TLS; tls = STARTTLS (secure:false + requireTLS)
      ...(encryption === 'tls' ? { requireTLS: true } : {}),
      ...(user ? { auth: { user, pass } } : {}),
      pool: true,
      maxConnections: 3,
    });
    return this.transporter;
  }

  /** The RFC "From" header, built from MAIL_FROM_NAME + MAIL_FROM_ADDRESS. */
  private from(): string {
    const address =
      this.config.get('MAIL_FROM_ADDRESS', { infer: true }) ||
      this.config.get('MAIL_USERNAME', { infer: true });
    const name = this.config.get('MAIL_FROM_NAME', { infer: true });
    return name ? `"${name}" <${address}>` : address;
  }

  /** Prove the SMTP credentials work without sending anything (used by the health/test route). */
  async verify(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) {
      return { ok: false, message: 'SMTP is not configured — set MAIL_HOST in .env' };
    }
    try {
      await this.getTransporter().verify();
      return { ok: true, message: `SMTP connection OK (${this.config.get('MAIL_HOST', { infer: true })})` };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`SMTP verify failed: ${message}`);
      return { ok: false, message };
    }
  }

  async send(options: SendMailOptions): Promise<{ messageId: string }> {
    if (!this.isConfigured()) {
      throw new Error('SMTP is not configured — set MAIL_HOST/MAIL_USERNAME/MAIL_PASSWORD in .env');
    }
    const info = await this.getTransporter().sendMail({
      from: this.from(),
      to: options.to,
      cc: options.cc || undefined,
      bcc: options.bcc || undefined,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
    });
    this.logger.log(`Mail sent to ${options.to} (${info.messageId})`);
    return { messageId: String(info.messageId) };
  }
}
