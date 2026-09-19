import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { tags, conversationTags } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';

export const tagsRouter = Router();
tagsRouter.use(requireAuth);

tagsRouter.get('/', async (req, res) => {
  const rows = await db.select().from(tags).where(eq(tags.businessId, req.session.businessId!));
  res.json(rows);
});

const createSchema = z.object({ name: z.string().min(1), color: z.string().optional() });

tagsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(tags).values({ businessId: req.session.businessId!, ...parsed.data }).returning();
  res.json(row);
});

tagsRouter.delete('/:id', async (req, res) => {
  await db.delete(tags).where(and(eq(tags.id, req.params.id), eq(tags.businessId, req.session.businessId!)));
  res.json({ ok: true });
});

tagsRouter.post('/:id/assign/:conversationId', async (req, res) => {
  await db.insert(conversationTags).values({ conversationId: req.params.conversationId, tagId: req.params.id });
  res.json({ ok: true });
});

tagsRouter.delete('/:id/assign/:conversationId', async (req, res) => {
  await db.delete(conversationTags).where(
    and(eq(conversationTags.tagId, req.params.id), eq(conversationTags.conversationId, req.params.conversationId)),
  );
  res.json({ ok: true });
});
