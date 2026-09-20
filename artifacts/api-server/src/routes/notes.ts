import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { notes, conversations } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';

export const notesRouter = Router();
notesRouter.use(requireAuth);

notesRouter.get('/:conversationId', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, req.params.conversationId), eq(conversations.businessId, businessId)))
    .limit(1);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });

  const rows = await db
    .select()
    .from(notes)
    .where(eq(notes.conversationId, req.params.conversationId))
    .orderBy(desc(notes.createdAt));
  res.json(rows);
});

const createSchema = z.object({ body: z.string().min(1) });

notesRouter.post('/:conversationId', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db
    .insert(notes)
    .values({ conversationId: req.params.conversationId, authorId: req.tenant!.userId, body: parsed.data.body })
    .returning();
  res.json(row);
});

notesRouter.delete('/entry/:noteId', async (req, res) => {
  const businessId = req.tenant!.businessId;
  // Scope the delete to this business by joining back through the conversation, so one
  // business can't delete another's note by guessing an id.
  const [row] = await db
    .select({ noteId: notes.id })
    .from(notes)
    .innerJoin(conversations, eq(conversations.id, notes.conversationId))
    .where(and(eq(notes.id, req.params.noteId), eq(conversations.businessId, businessId)))
    .limit(1);
  if (!row) return res.status(404).json({ error: 'Note not found.' });

  await db.delete(notes).where(eq(notes.id, req.params.noteId));
  res.json({ ok: true });
});
