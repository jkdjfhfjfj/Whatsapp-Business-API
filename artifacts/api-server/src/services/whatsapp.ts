// Thin service layer around `whatsappcloudapi_wrapper`. Every outbound send and every inbound
// webhook payload goes through here, so the rest of the app never touches the Meta API directly.
// See SPEC.md Section 4a for the full rationale and limits documentation.

// The package ships as CommonJS; import it via createRequire for clean ESM interop.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { lookup as lookupMimeType } from 'mime-types';
const require = createRequire(import.meta.url);
const WhatsappCloudAPI = require('whatsappcloudapi_wrapper');
const execFile = promisify(execFileCallback);

export interface WabaCredentials {
  accessToken: string;
  senderPhoneNumberId: string;
  WABA_ID: string;
  appId?: string;
}

export interface SimpleButton {
  title: string;
  id?: string;
  link?: string;
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

function normalizeAccessToken(token: string): string {
  return token.trim().replace(/^Bearer\s+/i, '');
}

export function validateSimpleButtons(buttons: SimpleButton[]) {
  if (buttons.length < 1 || buttons.length > 3) {
    throw new Error('sendSimpleButtons supports between 1 and 3 buttons.');
  }
    for (const b of buttons) {
    if (b.title.length < 1 || b.title.length > 20) {
      throw new Error(`Button title "${b.title}" must be 1-20 characters.`);
    }
      if (!b.id && !b.link) {
        throw new Error(`Button "${b.title}" needs a reply id or a link.`);
      }
      if (b.id && b.id.length > 256) {
      throw new Error(`Button id "${b.id}" must be 1-256 characters.`);
    }
      if (b.link) {
        try { new URL(b.link); } catch { throw new Error(`Button link "${b.link}" must be a valid URL.`); }
      }
      if (b.id && b.link) throw new Error(`Button "${b.title}" cannot have both a reply id and a link.`);
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
  private senderPhoneNumberId: string;
  private appId?: string;

  constructor(credentials: WabaCredentials & { apiVersion?: string }) {
    this.accessToken = normalizeAccessToken(credentials.accessToken);
    this.apiVersion = credentials.apiVersion ?? 'v20.0';
    this.senderPhoneNumberId = credentials.senderPhoneNumberId;
    this.appId = credentials.appId;
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

  async getBusinessProfile() {
    const response = await fetch(
      `https://graph.facebook.com/${this.apiVersion}/${this.senderPhoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );
    const data = await response.json().catch(() => ({})) as { data?: unknown[] };
    if (!response.ok) throw new Error(formatMetaApiError('read business profile', response.status, data));
    return data?.data?.[0] ?? data;
  }

  async updateBusinessProfile(profile: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    vertical?: string;
    websites?: string[];
    profilePictureHandle?: string;
  }) {
    const payload = {
      messaging_product: 'whatsapp',
      ...(profile.about !== undefined ? { about: profile.about } : {}),
      ...(profile.address !== undefined ? { address: profile.address } : {}),
      ...(profile.description !== undefined ? { description: profile.description } : {}),
      ...(profile.email !== undefined ? { email: profile.email } : {}),
      ...(profile.vertical !== undefined ? { vertical: profile.vertical } : {}),
      ...(profile.websites !== undefined ? { websites: profile.websites } : {}),
      ...(profile.profilePictureHandle ? { profile_picture_handle: profile.profilePictureHandle } : {}),
    };
    return this.sendGraphRequest(`/${this.senderPhoneNumberId}/whatsapp_business_profile`, 'POST', payload);
  }

  async uploadBusinessProfilePicture(filePath: string, mimeType: string, filename: string) {
    if (!this.appId) throw new Error('Meta App ID is required to upload a business profile picture.');
    const buffer = await fs.readFile(filePath);
    const sessionUrl = new URL(`https://graph.facebook.com/${this.apiVersion}/${this.appId}/uploads`);
    sessionUrl.searchParams.set('file_length', String(buffer.length));
    sessionUrl.searchParams.set('file_type', mimeType);
    sessionUrl.searchParams.set('file_name', filename);
    const sessionResponse = await fetch(sessionUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    const sessionData = await sessionResponse.json().catch(() => ({})) as { id?: string };
    if (!sessionResponse.ok || !sessionData.id) {
      throw new Error(formatMetaApiError('create profile picture upload session', sessionResponse.status, sessionData));
    }

    const uploadResponse = await fetch(`https://graph.facebook.com/${this.apiVersion}/${sessionData.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'file_offset': '0',
        'Content-Type': mimeType,
      },
      body: buffer,
    });
    const uploadData = await uploadResponse.json().catch(() => ({})) as { h?: string };
    if (!uploadResponse.ok || !uploadData.h) {
      throw new Error(formatMetaApiError('upload profile picture', uploadResponse.status, uploadData));
    }
    return uploadData.h;
  }

  async sendText(recipientPhone: string, message: string) {
    return this.sendMessage(recipientPhone, {
      type: 'text',
      text: { preview_url: false, body: message },
    });
  }

  async sendImage(recipientPhone: string, opts: MediaSendOptions) {
    return this.sendMediaMessage(recipientPhone, 'image', opts);
  }

  async sendDocument(recipientPhone: string, opts: MediaSendOptions) {
    return this.sendMediaMessage(recipientPhone, 'document', opts);
  }

  async sendVideo(recipientPhone: string, opts: MediaSendOptions) {
    return this.sendMediaMessage(recipientPhone, 'video', opts);
  }

  async sendAudio(recipientPhone: string, opts: MediaSendOptions) {
    return this.sendMediaMessage(recipientPhone, 'audio', opts);
  }

  async sendLocation(recipientPhone: string, opts: { latitude: string; longitude: string; name: string; address: string }) {
    return this.client.sendLocation({ recipientPhone: normalizePhone(recipientPhone), ...opts });
  }

  async sendSimpleButtons(recipientPhone: string, opts: {
    message: string;
    buttons: SimpleButton[];
    headerText?: string;
    footerText?: string;
  }) {
    validateSimpleButtons(opts.buttons);
    const linkedButton = opts.buttons.find((button) => button.link);
    if (linkedButton) {
      if (opts.buttons.length !== 1 || !linkedButton.link) {
        throw new Error('A URL button message must contain exactly one button.');
      }
      return this.sendMessage(recipientPhone, {
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          ...(opts.headerText ? { header: { type: 'text', text: opts.headerText } } : {}),
          body: { text: opts.message },
          ...(opts.footerText ? { footer: { text: opts.footerText } } : {}),
          action: {
            name: 'cta_url',
            parameters: { display_text: linkedButton.title, url: linkedButton.link },
          },
        },
      });
    }
    return this.sendMessage(recipientPhone, {
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(opts.headerText ? { header: { type: 'text', text: opts.headerText } } : {}),
        body: { text: opts.message },
        ...(opts.footerText ? { footer: { text: opts.footerText } } : {}),
         action: { buttons: opts.buttons.map((button) => ({ type: 'reply', reply: { id: button.id, title: button.title } })) },
      },
    });
  }

  async sendRadioButtons(recipientPhone: string, opts: {
    headerText?: string; bodyText: string; footerText?: string; actionTitle?: string; listOfSections: RadioSection[];
  }) {
    validateRadioSections(opts.listOfSections);
    return this.sendMessage(recipientPhone, {
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(opts.headerText ? { header: { type: 'text', text: opts.headerText } } : {}),
        body: { text: opts.bodyText },
        ...(opts.footerText ? { footer: { text: opts.footerText } } : {}),
        action: {
          button: opts.actionTitle || 'View options',
          sections: opts.listOfSections,
        },
      },
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
      const response = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.senderPhoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });
      if (!response.ok) throw new Error(`Mark-as-read failed: ${response.status} ${await response.text()}`);
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
    const metaData = (await metaRes.json().catch(() => ({}))) as { url?: string; mime_type?: string; error?: { message?: string; code?: number } };
    if (!metaRes.ok) {
      throw new Error(formatMetaApiError('resolve media URL', metaRes.status, metaData));
    }
    const meta = metaData as { url?: string; mime_type?: string };
    if (!meta.url) throw new Error('Meta returned no media URL. The media ID may have expired.');
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!fileRes.ok) {
      throw new Error(`Failed to download media: ${fileRes.status}${fileRes.status === 401 ? ' — Meta rejected the access token while downloading the file.' : ''}`);
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { buffer, mimeType: meta.mime_type ?? 'application/octet-stream' };
  }

  private async sendMessage(recipientPhone: string, payload: Record<string, unknown>) {
    return this.sendGraphRequest(`/${this.senderPhoneNumberId}/messages`, 'POST', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizePhone(recipientPhone),
      ...payload,
    }, 'send message');
  }

  private async sendGraphRequest(pathname: string, method: 'GET' | 'POST', payload?: Record<string, unknown>, operation = 'send message') {
    const response = await fetch(`https://graph.facebook.com/${this.apiVersion}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(formatMetaApiError(operation, response.status, data));
    return data;
  }

  private async sendMediaMessage(
    recipientPhone: string,
    type: 'image' | 'video' | 'audio' | 'document',
    opts: MediaSendOptions,
  ) {
    const mediaPayload: Record<string, unknown> = {};
    if (opts.caption && type !== 'audio') mediaPayload.caption = opts.caption;
    if (type === 'document' && opts.filename) mediaPayload.filename = opts.filename;

    if (opts.url) {
      mediaPayload.link = opts.url;
    } else if (opts.file_path) {
      let uploadPath = opts.file_path;
      let uploadMimeType = opts.mimeType || lookupMimeType(opts.filename ?? path.basename(opts.file_path)) || defaultMimeType(type);
      let uploadFilename = opts.filename ?? path.basename(opts.file_path);
      let cleanupPath: string | undefined;
      try {
        if (type === 'audio') {
          const prepared = await prepareAudioForWhatsApp(uploadPath);
          uploadPath = prepared.filePath;
          uploadMimeType = prepared.mimeType;
          uploadFilename = prepared.filename;
          cleanupPath = prepared.filePath;
        }
        mediaPayload.id = await this.uploadMedia(uploadPath, uploadMimeType, uploadFilename);
      } finally {
        if (cleanupPath) await fs.rm(cleanupPath, { force: true }).catch(() => {});
      }
    } else {
      throw new Error(`A ${type} requires a public URL or an uploaded file.`);
    }

    return this.sendMessage(recipientPhone, { type, [type]: mediaPayload });
  }

  private async uploadMedia(filePath: string, mimeType: string, filename: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    // Meta requires the MIME type both on the multipart file and as the explicit `type` field.
    form.append('type', mimeType);
    form.append('file', new Blob([buffer], { type: mimeType }), filename);

    const response = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.senderPhoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form,
    });
    const data = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } };
    if (!response.ok || typeof data?.id !== 'string') {
      throw new Error(formatMetaApiError('upload media', response.status, data));
    }
    return data.id;
  }
}

async function prepareAudioForWhatsApp(filePath: string): Promise<{ filePath: string; mimeType: string; filename: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whatsapp-audio-'));
  const outputPath = path.join(tempDir, 'voice-note.ogg');
  try {
    await execFile('ffmpeg', [
      '-nostdin',
      '-y',
      '-i', filePath,
      '-vn',
      '-ac', '1',
      '-c:a', 'libopus',
      '-b:a', '64k',
      outputPath,
    ], { timeout: 120_000 });
    return { filePath: outputPath, mimeType: 'audio/ogg', filename: 'voice-note.ogg' };
  } catch (err) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not convert audio to WhatsApp-compatible OGG/Opus: ${detail}`);
  }
}

type MediaSendOptions = {
  url?: string;
  file_path?: string;
  mimeType?: string;
  filename?: string;
  caption?: string;
};

function defaultMimeType(type: 'image' | 'video' | 'audio' | 'document') {
  return {
    image: 'image/jpeg',
    video: 'video/mp4',
    audio: 'audio/ogg',
    document: 'application/octet-stream',
  }[type];
}

function formatMetaApiError(operation: string, status: number, data: unknown): string {
  const metaError = (data as { error?: { message?: string; code?: number } })?.error;
  if (status === 401 || metaError?.code === 190) {
    return `Meta rejected the access token while trying to ${operation} (OAuth error 190). Replace the Permanent Access Token in Settings → WhatsApp, then save and test the connection.`;
  }
  return metaError?.message
    ? `Meta API error ${metaError.code ?? status}: ${metaError.message}`
    : `Meta API error ${status}: ${JSON.stringify(data)}`;
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
