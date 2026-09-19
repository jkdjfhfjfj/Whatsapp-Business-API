import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { quickReplies } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';

export const quickRepliesRouter = Router();
quickRepliesRouter.use(requireAuth);

quickRepliesRouter.get('/', async (req, res) => {
  const rows = await db.select().from(quickReplies).where(eq(quickReplies.businessId, req.session.businessId!));
  res.json(rows);
});

const createSchema = z.object({ shortcut: z.string().min(1), message: z.string().min(1), category: z.string().optional() });

quickRepliesRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db.insert(quickReplies).values({ businessId: req.session.businessId!, ...parsed.data }).returning();
  res.json(row);
});

quickRepliesRouter.delete('/:id', async (req, res) => {
  await db.delete(quickReplies).where(and(eq(quickReplies.id, req.params.id), eq(quickReplies.businessId, req.session.businessId!)));
  res.json({ ok: true });
});
