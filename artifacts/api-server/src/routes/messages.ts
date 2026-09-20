import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { conversations, contacts, messages, media } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';
import { getWhatsAppClientForBusiness } from '../services/getWhatsAppClient.js';
import { formatWhatsAppError } from '../services/whatsapp.js';
import { broadcastToBusiness } from '../services/websocket.js';
import { materializeLocalFile } from '../services/storage.js';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

async function loadConversationAndContact(businessId: string, conversationId: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.businessId, businessId)))
    .limit(1);
  if (!conversation) return null;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, conversation.contactId)).limit(1);
  return { conversation, contact };
}

async function recordOutbound(businessId: string, conversationId: string, senderId: string, type: string, content: Record<string, unknown>, whatsappMessageId?: string) {
  const [saved] = await db
    .insert(messages)
    .values({ conversationId, businessId, direction: 'outbound', senderType: 'agent', senderId, type, content, whatsappMessageId, status: 'sent' })
    .returning();
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
  broadcastToBusiness(businessId, 'message:new', saved);
  return saved;
}

const textSchema = z.object({ conversationId: z.string().uuid(), message: z.string().min(1) });

messagesRouter.post('/text', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const parsed = textSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const ctx = await loadConversationAndContact(businessId, parsed.data.conversationId);
  if (!ctx) return res.status(404).json({ error: 'Conversation not found.' });

  const wa = await getWhatsAppClientForBusiness(businessId);
  if (!wa) return res.status(400).json({ error: 'WhatsApp is not configured for this business yet.' });

  try {
    await wa.sendText(ctx.contact.waId, parsed.data.message);
    const saved = await recordOutbound(businessId, ctx.conversation.id, req.tenant!.userId, 'text', { text: parsed.data.message });
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: formatWhatsAppError(err) });
  }
});

const buttonsSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().min(1),
  buttons: z.array(z.object({ title: z.string(), id: z.string() })).min(1).max(3),
});

messagesRouter.post('/buttons', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const parsed = buttonsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const ctx = await loadConversationAndContact(businessId, parsed.data.conversationId);
  if (!ctx) return res.status(404).json({ error: 'Conversation not found.' });

  const wa = await getWhatsAppClientForBusiness(businessId);
  if (!wa) return res.status(400).json({ error: 'WhatsApp is not configured for this business yet.' });

  try {
    await wa.sendSimpleButtons(ctx.contact.waId, parsed.data.message, parsed.data.buttons);
    const saved = await recordOutbound(businessId, ctx.conversation.id, req.tenant!.userId, 'interactive_buttons', {
      message: parsed.data.message,
      buttons: parsed.data.buttons,
    });
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: formatWhatsAppError(err) });
  }
});

const listSchema = z.object({
  conversationId: z.string().uuid(),
  headerText: z.string(),
  bodyText: z.string(),
  footerText: z.string().optional(),
  listOfSections: z.array(z.object({
    title: z.string(),
    rows: z.array(z.object({ title: z.string(), description: z.string(), id: z.string() })),
  })).min(1),
});

messagesRouter.post('/list', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const parsed = listSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const ctx = await loadConversationAndContact(businessId, parsed.data.conversationId);
  if (!ctx) return res.status(404).json({ error: 'Conversation not found.' });

  const wa = await getWhatsAppClientForBusiness(businessId);
  if (!wa) return res.status(400).json({ error: 'WhatsApp is not configured for this business yet.' });

  try {
    const { conversationId, ...opts } = parsed.data;
    await wa.sendRadioButtons(ctx.contact.waId, opts);
    const saved = await recordOutbound(businessId, ctx.conversation.id, req.tenant!.userId, 'interactive_list', opts);
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: formatWhatsAppError(err) });
  }
});

// Image/document/video/audio sends accept either a public URL, a local file_path already on
// disk, or (most commonly from the UI) a mediaId returned by POST /api/uploads.
const mediaSchema = z.object({
  conversationId: z.string().uuid(),
  url: z.string().url().optional(),
  file_path: z.string().optional(),
  mediaId: z.string().uuid().optional(),
  caption: z.string().optional(),
});

for (const [path, method] of [
  ['image', 'sendImage'],
  ['document', 'sendDocument'],
  ['video', 'sendVideo'],
  ['audio', 'sendAudio'],
] as const) {
  messagesRouter.post(`/${path}`, async (req, res) => {
    const businessId = req.tenant!.businessId;
    const parsed = mediaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let filePath = parsed.data.file_path;
    let originalFilename: string | undefined;
    let mimeType: string | undefined;
    let cleanup: (() => void) | null = null;
    if (parsed.data.mediaId) {
      const [mediaRow] = await db.select().from(media).where(and(eq(media.id, parsed.data.mediaId), eq(media.businessId, businessId))).limit(1);
      if (!mediaRow) return res.status(404).json({ error: 'Uploaded media not found.' });
      originalFilename = mediaRow.filename;
      mimeType = mediaRow.mimeType;
      try {
         const resolved = await materializeLocalFile(mediaRow.storagePath, mediaRow.storageProvider, businessId);
        filePath = resolved.filePath;
        cleanup = resolved.cleanup;
      } catch (err) {
        return res.status(502).json({ error: `Could not prepare media for sending: ${(err as Error).message}` });
      }
    }
    if (!parsed.data.url && !filePath) {
      return res.status(400).json({ error: 'Provide a url, file_path, or mediaId.' });
    }

    const ctx = await loadConversationAndContact(businessId, parsed.data.conversationId);
    if (!ctx) { cleanup?.(); return res.status(404).json({ error: 'Conversation not found.' }); }

    const wa = await getWhatsAppClientForBusiness(businessId);
    if (!wa) { cleanup?.(); return res.status(400).json({ error: 'WhatsApp is not configured for this business yet.' }); }

    try {
      await (wa[method] as (phone: string, opts: unknown) => Promise<unknown>)(ctx.contact.waId, {
        url: parsed.data.url,
        file_path: filePath,
        mimeType,
        filename: originalFilename,
        caption: parsed.data.caption,
      });
      const saved = await recordOutbound(businessId, ctx.conversation.id, req.tenant!.userId, path, {
        url: parsed.data.url,
        filename: originalFilename,
        mimeType,
        caption: parsed.data.caption,
        mediaId: parsed.data.mediaId,
      });
      if (parsed.data.mediaId) {
        await db.update(media).set({ messageId: saved.id }).where(eq(media.id, parsed.data.mediaId));
      }
      res.json(saved);
    } catch (err) {
      res.status(400).json({ error: formatWhatsAppError(err) });
    } finally {
      cleanup?.();
    }
  });
}
