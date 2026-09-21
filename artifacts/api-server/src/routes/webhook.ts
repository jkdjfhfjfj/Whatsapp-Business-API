import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { wabaSettings, contacts, conversations, messages, webhookEvents } from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getWhatsAppClientForBusiness } from '../services/getWhatsAppClient.js';
import { normalizePhone } from '../services/whatsapp.js';
import { maybeGenerateAiReply } from '../services/aiReply.js';
import { broadcastToBusiness } from '../services/websocket.js';

export const webhookRouter = Router();

const WINDOW_HOURS = 24;

// Meta calls GET once per business to verify the webhook. We check the verify token against
// every business's configured token since Meta doesn't tell us which business it's for yet.
webhookRouter.get('/', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe' || typeof token !== 'string') {
    return res.sendStatus(403);
  }

  // Render deployments can verify the callback before the database has been
  // migrated or before the default tenant exists. Prefer the explicit
  // environment token when present, then fall back to the token saved in the
  // WABA settings row.
  const configuredToken =
    process.env.WHATSAPP_VERIFY_TOKEN ??
    process.env.WEBHOOK_VERIFY_TOKEN ??
    process.env.VERIFY_TOKEN;
  if (configuredToken && token === configuredToken) {
    return res.status(200).send(challenge);
  }

  const [match] = await db.select().from(wabaSettings).where(eq(wabaSettings.webhookVerifyToken, token)).limit(1);
  if (!match) return res.sendStatus(403);

  res.status(200).send(challenge);
});

webhookRouter.post('/', async (req, res) => {
  // Identify which business this payload belongs to via the phone_number_id in the payload,
  // since Meta doesn't sign requests with a business identifier we already have.
  const phoneNumberId: string | undefined =
    req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

  if (!phoneNumberId) {
    return res.status(400).json({ error: 'Missing phone_number_id in webhook payload.' });
  }

  const [waba] = await db.select().from(wabaSettings).where(eq(wabaSettings.phoneNumberId, phoneNumberId)).limit(1);
  if (!waba) {
    return res.status(404).json({ error: 'No business configured for this phone number.' });
  }

  // Idempotency: dedupe on a hash of the raw payload plus the WhatsApp message id if present.
  const dedupeSeed = JSON.stringify(req.body);
  const eventKey = crypto.createHash('sha256').update(dedupeSeed).digest('hex');
  try {
    await db.insert(webhookEvents).values({ eventKey, businessId: waba.businessId, payload: req.body });
  } catch {
    // Unique constraint violation = already processed this exact payload.
    return res.sendStatus(200);
  }

  const wa = await getWhatsAppClientForBusiness(waba.businessId);
  if (!wa) return res.status(500).json({ error: 'WhatsApp client not configured.' });

  let parsed;
  try {
    parsed = wa.parseMessage(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid webhook payload: ${(err as Error).message}` });
  }

  // Always acknowledge quickly; do the DB/AI work before responding since this scaffold has no
  // background queue yet (see SPEC.md for a persistent-queue extension point).
  try {
    if (parsed?.isMessage) {
      await handleInboundMessage(waba.businessId, wa, parsed.message);
    } else if (parsed?.isNotificationMessage) {
      await handleStatusNotification(waba.businessId, parsed);
    }
  } catch (err) {
    console.error('Error processing webhook event:', err);
    // Still return 200 — we've already recorded the event, so a downstream bug shouldn't cause
    // Meta to keep retrying and re-triggering side effects like AI replies.
  }

  res.sendStatus(200);
});

async function handleInboundMessage(businessId: string, wa: Awaited<ReturnType<typeof getWhatsAppClientForBusiness>>, incoming: any) {
  if (!wa) return;
  const waId: string = normalizePhone(String(incoming.from.phone ?? ''));
  const waName: string | undefined = incoming.from.name;

  const now = new Date();
  const windowExpiresAt = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);
  const { contact, conversation } = await db.transaction(async (tx) => {
    // Webhooks can arrive concurrently. The advisory lock makes the lookup/create
    // sequence atomic for this business and normalized WhatsApp number.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${businessId}:${waId}`}))`);

    let [contact] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.businessId, businessId), eq(contacts.waId, waId)))
      .limit(1);

    if (!contact) {
      [contact] = await tx
        .insert(contacts)
        .values({ businessId, waId, waName, lastContactAt: now })
        .returning();
    } else {
      [contact] = await tx.update(contacts).set({
        ...(waName && waName !== contact.waName ? { waName } : {}),
        lastContactAt: now,
      }).where(eq(contacts.id, contact.id)).returning();
    }

    // A customer should have one working thread. Reopen the most recent thread
    // rather than creating a second conversation when an older one was resolved.
    let [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.businessId, businessId), eq(conversations.contactId, contact.id)))
      .orderBy(desc(conversations.updatedAt))
      .limit(1);

    if (!conversation) {
      [conversation] = await tx
        .insert(conversations)
        .values({ businessId, contactId: contact.id, lastCustomerMessageAt: now, windowExpiresAt, unreadCount: 1 })
        .returning();
    } else {
      [conversation] = await tx
        .update(conversations)
        .set({
          status: 'open',
          lastCustomerMessageAt: now,
          windowExpiresAt,
          unreadCount: conversation.unreadCount + 1,
          updatedAt: now,
        })
        .where(eq(conversations.id, conversation.id))
        .returning();
    }
    return { contact, conversation };
  });

  const content = extractContent(incoming);

  const [saved] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      businessId,
      direction: 'inbound',
      senderType: 'customer',
      type: content.type,
      content: content.body,
      whatsappMessageId: incoming.message_id,
      status: 'delivered',
    })
    .returning();

  broadcastToBusiness(businessId, 'message:new', saved);
  broadcastToBusiness(businessId, 'conversation:update', conversation);

  if (conversation.aiEnabled) {
    await maybeGenerateAiReply({ businessId, conversationId: conversation.id, recipientPhone: waId, wa });
  }
}

function extractContent(incoming: any): { type: string; body: Record<string, unknown> } {
  switch (incoming.type) {
    case 'text':
    case 'text_message':
    case 'ad_message':
      return { type: 'text', body: { text: incoming.text?.body ?? '' } };
    case 'simple_button_message':
    case 'quick_reply_message':
      return { type: 'button', body: { id: incoming.button_reply?.id, title: incoming.button_reply?.title } };
    case 'radio_button_message':
      return { type: 'list', body: { id: incoming.list_reply?.id, title: incoming.list_reply?.title } };
    case 'location':
    case 'location_message':
      return { type: 'location', body: incoming.location ?? {} };
    case 'contact_message':
      return { type: 'contact', body: { contacts: incoming.contacts ?? [] } };
    case 'media_message': {
      const mediaType = ['image', 'video', 'audio', 'document'].find((type) => incoming[type]);
      return mediaType
        ? { type: mediaType, body: incoming[mediaType] }
        : { type: 'unknown', body: incoming };
    }
    case 'audio_message':
      return { type: 'audio', body: incoming.audio ?? {} };
    case 'sticker_message':
      return { type: 'image', body: incoming.sticker ?? {} };
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
      return { type: incoming.type, body: incoming[incoming.type] ?? {} };
    default:
      return { type: incoming.type ?? 'unknown', body: incoming };
  }
}

async function handleStatusNotification(businessId: string, parsed: any) {
  // whatsappcloudapi_wrapper exposes the raw status as `notificationMessage` and
  // keeps Meta's message id in `id`. Older code looked for `notification.message_id`,
  // so every webhook was acknowledged but no outbound row was ever updated.
  const notification = parsed?.notificationMessage ?? parsed?.notification;
  const statusId = notification?.id ?? notification?.message_id ?? parsed?.message_id;
  const newStatus = normalizeMessageStatus(notification?.status ?? parsed?.status);
  if (!statusId || !newStatus) return;

  const [current] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.whatsappMessageId, statusId), eq(messages.businessId, businessId)))
    .limit(1);
  if (!current || statusRank(newStatus) < statusRank(current.status)) return;

  const [updated] = await db
    .update(messages)
    .set({ status: newStatus })
    .where(and(eq(messages.whatsappMessageId, statusId), eq(messages.businessId, businessId)))
    .returning();

  if (updated) broadcastToBusiness(businessId, 'message:status', updated);
}

function normalizeMessageStatus(status: unknown): string | undefined {
  return status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed'
    ? status
    : undefined;
}

function statusRank(status: string) {
  return { sent: 1, delivered: 2, read: 3, failed: 4 }[status] ?? 0;
}
