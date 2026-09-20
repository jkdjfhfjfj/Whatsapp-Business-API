import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { tags, conversationTags, conversations } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';

export const tagsRouter = Router();
tagsRouter.use(requireAuth);

tagsRouter.get('/', async (req, res) => {
  const rows = await db.select().from(tags).where(eq(tags.businessId, req.tenant!.businessId));
  res.json(rows);
});

const createSchema = z.object({ name: z.string().min(1), color: z.string().optional() });

tagsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(tags).values({ businessId: req.tenant!.businessId, ...parsed.data }).returning();
  res.json(row);
});

tagsRouter.delete('/:id', async (req, res) => {
  await db.delete(tags).where(and(eq(tags.id, req.params.id), eq(tags.businessId, req.tenant!.businessId)));
  res.json({ ok: true });
});

tagsRouter.post('/:id/assign/:conversationId', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const [tag] = await db.select().from(tags).where(and(eq(tags.id, req.params.id), eq(tags.businessId, businessId))).limit(1);
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, req.params.conversationId), eq(conversations.businessId, businessId)))
    .limit(1);
  if (!tag || !conversation) return res.status(404).json({ error: 'Tag or conversation not found.' });

  const [existing] = await db
    .select()
    .from(conversationTags)
    .where(and(eq(conversationTags.tagId, tag.id), eq(conversationTags.conversationId, conversation.id)))
    .limit(1);
  if (!existing) {
    await db.insert(conversationTags).values({ conversationId: conversation.id, tagId: tag.id });
  }
  res.json({ ok: true });
});

tagsRouter.delete('/:id/assign/:conversationId', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const [tag] = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.id, req.params.id), eq(tags.businessId, businessId))).limit(1);
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, req.params.conversationId), eq(conversations.businessId, businessId)))
    .limit(1);
  if (!tag || !conversation) return res.status(404).json({ error: 'Tag or conversation not found.' });

  await db.delete(conversationTags).where(
    and(eq(conversationTags.tagId, tag.id), eq(conversationTags.conversationId, conversation.id)),
  );
  res.json({ ok: true });
});
