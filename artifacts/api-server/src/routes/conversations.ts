import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { conversations, contacts, messages, tags, conversationTags } from '../db/schema.js';
import { eq, and, desc, ilike, or, sql } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';
import { getWhatsAppClientForBusiness } from '../services/getWhatsAppClient.js';
import { normalizePhone } from '../services/whatsapp.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

conversationsRouter.get('/', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' && req.query.search ? req.query.search : undefined;

  const conditions = [eq(conversations.businessId, businessId)];
  if (status) conditions.push(eq(conversations.status, status));
  if (search) {
    conditions.push(
      or(ilike(contacts.name, `%${search}%`), ilike(contacts.waName, `%${search}%`), ilike(contacts.waId, `%${search}%`))!,
    );
  }

  const rows = await db
    .select({
      conversation: conversations,
      contact: contacts,
      tagNames: sql<string[]>`coalesce(array_agg(distinct ${tags.name}) filter (where ${tags.name} is not null), '{}')`,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .leftJoin(conversationTags, eq(conversationTags.conversationId, conversations.id))
    .leftJoin(tags, eq(tags.id, conversationTags.tagId))
    .where(and(...conditions))
    .groupBy(conversations.id, contacts.id)
    .orderBy(desc(conversations.updatedAt));

  res.json(rows);
});

const startConversationSchema = z.object({
  phone: z.string().trim().min(7).max(32),
});

conversationsRouter.post('/start', async (req, res) => {
  const parsed = startConversationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter an international WhatsApp number.' });

  const waId = normalizePhone(parsed.data.phone);
  if (waId.length < 7 || waId.length > 15) {
    return res.status(400).json({ error: 'Enter a valid international WhatsApp number, including the country code.' });
  }

  const businessId = req.tenant!.businessId;
  const result = await db.transaction(async (tx) => {
    let [contact] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.businessId, businessId), eq(contacts.waId, waId)))
      .limit(1);

    if (!contact) {
      [contact] = await tx.insert(contacts).values({ businessId, waId }).returning();
    }

    let [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.businessId, businessId), eq(conversations.contactId, contact.id)))
      .orderBy(desc(conversations.updatedAt))
      .limit(1);

    if (conversation) {
      [conversation] = await tx
        .update(conversations)
        .set({ status: 'open', updatedAt: new Date() })
        .where(eq(conversations.id, conversation.id))
        .returning();
    } else {
      [conversation] = await tx
        .insert(conversations)
        .values({ businessId, contactId: contact.id, status: 'open' })
        .returning();
    }

    return { conversation, contact };
  });

  res.json(result);
});

conversationsRouter.get('/:id', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, req.params.id), eq(conversations.businessId, businessId)))
    .limit(1);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, conversation.contactId)).limit(1);
  const thread = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(messages.createdAt);

  res.json({ conversation, contact, messages: thread });
});

// Mark as read: resets the unread counter and marks the latest inbound message read via the
// wrapper's markMessageAsRead.
conversationsRouter.post('/:id/read', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, req.params.id), eq(conversations.businessId, businessId)))
    .limit(1);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });

  await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, conversation.id));

  const [lastInbound] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), eq(messages.direction, 'inbound')))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  if (lastInbound?.whatsappMessageId) {
    const wa = await getWhatsAppClientForBusiness(businessId);
    if (wa) await wa.markMessageAsRead(lastInbound.whatsappMessageId);
  }

  res.json({ ok: true });
});

conversationsRouter.patch('/:id', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const { status, aiEnabled, assignedAgentId } = req.body as {
    status?: string; aiEnabled?: boolean; assignedAgentId?: string | null;
  };

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (status !== undefined) update.status = status;
  if (aiEnabled !== undefined) update.aiEnabled = aiEnabled;
  if (assignedAgentId !== undefined) update.assignedAgentId = assignedAgentId;

  const [updated] = await db
    .update(conversations)
    .set(update)
    .where(and(eq(conversations.id, req.params.id), eq(conversations.businessId, businessId)))
    .returning();

  if (!updated) return res.status(404).json({ error: 'Conversation not found.' });
  res.json(updated);
});
