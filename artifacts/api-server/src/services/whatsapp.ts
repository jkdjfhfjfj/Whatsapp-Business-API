// Thin service layer around `whatsappcloudapi_wrapper`. Every outbound send and every inbound
// webhook payload goes through here, so the rest of the app never touches the Meta API directly.
// See SPEC.md Section 4a for the full rationale and limits documentation.

// The package ships as CommonJS; import it via createRequire for clean ESM interop.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WhatsappCloudAPI = require('whatsappcloudapi_wrapper');

export interface WabaCredentials {
  accessToken: string;
  senderPhoneNumberId: string;
  WABA_ID: string;
}

export interface SimpleButton {
  title: string;
  id: string;
}

export interface RadioSection {
  title: string;
  rows: { title: string; description: string; id: string }[];
}

// Normalize a stored phone number to the wrapper's expected format: international, digits only,
// no leading '+'.
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

export function validateSimpleButtons(buttons: SimpleButton[]) {
  if (buttons.length < 1 || buttons.length > 3) {
    throw new Error('sendSimpleButtons supports between 1 and 3 buttons.');
  }
  for (const b of buttons) {
    if (b.title.length < 1 || b.title.length > 20) {
      throw new Error(`Button title "${b.title}" must be 1-20 characters.`);
    }
    if (b.id.length < 1 || b.id.length > 256) {
      throw new Error(`Button id "${b.id}" must be 1-256 characters.`);
    }
  }
}

export function validateRadioSections(sections: RadioSection[]) {
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  if (totalRows < 1 || totalRows > 10) {
    throw new Error('sendRadioButtons supports between 1 and 10 rows total across all sections.');
  }
  for (const s of sections) {
    if (s.title.length < 1 || s.title.length > 24) {
      throw new Error(`Section/list title "${s.title}" must be 1-24 characters.`);
    }
    for (const r of s.rows) {
      if (r.title.length < 1 || r.title.length > 24) {
        throw new Error(`Row title "${r.title}" must be 1-24 characters.`);
      }
      if (r.description.length < 1 || r.description.length > 72) {
        throw new Error(`Row description for "${r.title}" must be 1-72 characters.`);
      }
      if (r.id.length < 1 || r.id.length > 200) {
        throw new Error(`Row id "${r.id}" must be 1-200 characters.`);
      }
    }
  }
}

export class WhatsAppService {
  private client: any;
  private accessToken: string;
  private apiVersion: string;

  constructor(credentials: WabaCredentials & { apiVersion?: string }) {
    this.accessToken = credentials.accessToken;
    this.apiVersion = credentials.apiVersion ?? 'v20.0';
    // The wrapper calls this option graphAPIVersion. Passing apiVersion directly is
    // ignored, which makes it fall back to its old v13.0 default.
    this.client = new WhatsappCloudAPI({
      ...credentials,
      graphAPIVersion: this.apiVersion,
    });
  }

  async verifyCredentials() {
    const response = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.client.senderPhoneNumberId}?fields=id,display_phone_number`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!response.ok) {
      const message = data?.error?.message ?? `Meta credential check failed with HTTP ${response.status}.`;
      throw new Error(message);
    }
    return data;
  }

  async sendText(recipientPhone: string, message: string) {
    return this.client.sendText({ message, recipientPhone: normalizePhone(recipientPhone) });
  }

  async sendImage(recipientPhone: string, opts: { file_path: string; caption?: string }) {
    return this.client.sendImage({
      recipientPhone: normalizePhone(recipientPhone),
      caption: opts.caption,
      file_path: opts.file_path,
    });
  }

  async sendDocument(recipientPhone: string, opts: { url?: string; file_path?: string; caption?: string }) {
    return this.client.sendDocument({
      recipientPhone: normalizePhone(recipientPhone),
      caption: opts.caption,
      url: opts.url,
      file_path: opts.file_path,
    });
  }

  async sendVideo(recipientPhone: string, opts: { url?: string; file_path?: string; caption?: string }) {
    return this.client.sendVideo({
      recipientPhone: normalizePhone(recipientPhone),
      caption: opts.caption,
      url: opts.url,
      file_path: opts.file_path,
    });
  }

  async sendAudio(recipientPhone: string, opts: { url?: string; file_path?: string }) {
    return this.client.sendAudio({
      recipientPhone: normalizePhone(recipientPhone),
      url: opts.url,
      file_path: opts.file_path,
    });
  }

  async sendLocation(recipientPhone: string, opts: { latitude: string; longitude: string; name: string; address: string }) {
    return this.client.sendLocation({ recipientPhone: normalizePhone(recipientPhone), ...opts });
  }

  async sendSimpleButtons(recipientPhone: string, message: string, listOfButtons: SimpleButton[]) {
    validateSimpleButtons(listOfButtons);
    return this.client.sendSimpleButtons({
      recipientPhone: normalizePhone(recipientPhone),
      message,
      listOfButtons,
    });
  }

  async sendRadioButtons(recipientPhone: string, opts: {
    headerText: string; bodyText: string; footerText?: string; listOfSections: RadioSection[];
  }) {
    validateRadioSections(opts.listOfSections);
    return this.client.sendRadioButtons({
      recipientPhone: normalizePhone(recipientPhone),
      ...opts,
    });
  }

  async sendContact(recipientPhone: string, contact_profile: unknown) {
    return this.client.sendContact({ recipientPhone: normalizePhone(recipientPhone), contact_profile });
  }

  async createQRCodeMessage(message: string, imageType: 'png' | 'svg' = 'png') {
    const result = await this.client.createQRCodeMessage({ message, imageType });
    return result?.data?.qr_image_url as string | undefined;
  }

  async markMessageAsRead(messageId: string) {
    try {
      await this.client.markMessageAsRead({ message_id: messageId });
    } catch (err) {
      // The wrapper throws a non-retryable error if the message is missing or already read.
      // That's not a real failure for our purposes, so we swallow it rather than retry.
      console.warn('markMessageAsRead: non-retryable error, ignoring:', (err as Error).message);
    }
  }

  // Parses a raw inbound webhook body. Throws if the payload is invalid / not from Meta —
  // callers should catch this and respond with HTTP 4xx, not 200.
  parseMessage(body: unknown) {
    return this.client.parseMessage(body);
  }

  // The wrapper doesn't cover media download, so this goes straight to the Graph API: first
  // resolve the media id to a short-lived URL, then fetch the binary with the same access token.
  // Meta's media URLs expire quickly, which is why inbound media gets downloaded once here and
  // cached to local storage (see routes/uploads.ts) rather than re-fetched on every view.
  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const metaRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!metaRes.ok) {
      throw new Error(`Failed to resolve media URL: ${metaRes.status} ${await metaRes.text()}`);
    }
    const meta = (await metaRes.json()) as { url: string; mime_type?: string };
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!fileRes.ok) {
      throw new Error(`Failed to download media: ${fileRes.status}`);
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { buffer, mimeType: meta.mime_type ?? 'application/octet-stream' };
  }
}

export function formatWhatsAppError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const value = err as { error?: unknown; message?: unknown };
    if (typeof value.message === 'string' && value.message) return value.message;
    if (typeof value.error === 'string' && value.error) return value.error;
    if (value.error && typeof value.error === 'object') {
      const nested = value.error as { message?: unknown; error_data?: { details?: unknown } };
      if (typeof nested.message === 'string' && nested.message) return nested.message;
      if (typeof nested.error_data?.details === 'string' && nested.error_data.details) return nested.error_data.details;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return 'WhatsApp request failed.';
    }
  }
  return 'WhatsApp request failed.';
}
