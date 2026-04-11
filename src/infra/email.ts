/**
 * Email adapter — Execution Spec §8.4.
 *
 * Two implementations:
 *   - `ConsoleEmailAdapter`  — logs the outgoing email to stdout (dev default)
 *   - `SendGridEmailAdapter` — stub that throws until the real SDK is wired
 *
 * The adapter is selected at startup based on `EMAIL_PROVIDER` + key env.
 * Tests can force an in-memory capture adapter via `setEmailAdapter(...)`
 * so they can assert on emitted messages.
 */

import { config } from './config';
import { logger } from './logger';

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  content_type: string;
};

export type EmailInput = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  reply_to?: string;
  metadata?: Record<string, string>;
};

export type EmailResult = {
  message_id: string;
  provider: string;
};

export interface EmailAdapter {
  readonly name: string;
  send(input: EmailInput): Promise<EmailResult>;
}

/* ---------- Console adapter (dev default) ---------- */

class ConsoleEmailAdapter implements EmailAdapter {
  readonly name = 'console';
  async send(input: EmailInput): Promise<EmailResult> {
    logger.info(
      {
        to: input.to,
        subject: input.subject,
        attachments: input.attachments?.length ?? 0,
        metadata: input.metadata,
      },
      'email dispatched (console)',
    );
    return {
      message_id: `console-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      provider: 'console',
    };
  }
}

/* ---------- SendGrid stub ---------- */

class SendGridEmailAdapter implements EmailAdapter {
  readonly name = 'sendgrid';
  async send(_input: EmailInput): Promise<EmailResult> {
    throw new Error('SendGridEmailAdapter not yet wired — install @sendgrid/mail and implement');
  }
}

/* ---------- In-memory capture adapter (tests) ---------- */

export class CaptureEmailAdapter implements EmailAdapter {
  readonly name = 'capture';
  public captured: EmailInput[] = [];
  async send(input: EmailInput): Promise<EmailResult> {
    this.captured.push(input);
    return {
      message_id: `capture-${this.captured.length}`,
      provider: 'capture',
    };
  }
  reset(): void {
    this.captured = [];
  }
}

/* ---------- Selection ---------- */

let adapter: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (adapter) return adapter;
  if (config.email.provider === 'sendgrid' && config.email.sendgridApiKey) {
    adapter = new SendGridEmailAdapter();
  } else {
    adapter = new ConsoleEmailAdapter();
  }
  logger.info({ adapter: adapter.name }, 'email adapter initialized');
  return adapter;
}

export function setEmailAdapter(next: EmailAdapter | null): void {
  adapter = next;
}
