import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { quickReplies } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';

export const quickRepliesRouter = Router();
quickRepliesRouter.use(requireAuth);

quickRepliesRouter.get('/', async (req, res) => {
  const rows = await db.select().from(quickReplies).where(eq(quickReplies.businessId, req.tenant!.businessId));
  res.json(rows);
});

const buttonSchema = z.object({
  title: z.string().min(1).max(20),
  id: z.string().max(256).optional(),
  link: z.string().url().max(2048).optional(),
}).refine((button) => Boolean(button.id || button.link), { message: 'Each button needs a reply ID or a URL link.' });
const rowSchema = z.object({
  title: z.string().min(1).max(24),
  description: z.string().min(1).max(72),
  id: z.string().min(1).max(200),
});
const createSchema = z.object({
  shortcut: z.string().min(1),
  message: z.string().min(1),
  messageType: z.enum(['text', 'buttons', 'list']).default('text'),
  payload: z.record(z.unknown()).default({}),
  category: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.messageType === 'buttons') {
    const buttons = value.payload.buttons;
    if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'buttons'], message: 'Buttons quick replies need 1-3 buttons.' });
      return;
    }
    const parsed = z.array(buttonSchema).safeParse(buttons);
    if (!parsed.success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'buttons'], message: 'Each button needs a 1-20 character title and a 1-256 character id.' });
  }
  if (value.messageType === 'list') {
    const sections = value.payload.listOfSections;
    if (!Array.isArray(sections) || sections.length < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'listOfSections'], message: 'List quick replies need at least one section.' });
      return;
    }
    const rows = sections.flatMap((section) => (section && typeof section === 'object' && Array.isArray((section as any).rows) ? (section as any).rows : []));
    if (rows.length < 1 || rows.length > 10 || !z.array(rowSchema).safeParse(rows).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'listOfSections'], message: 'List quick replies need 1-10 valid rows.' });
    }
  }
});

quickRepliesRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const shortcut = parsed.data.shortcut.trim().replace(/^\/+/, '');
  if (!shortcut) return res.status(400).json({ error: 'Shortcut must contain at least one character.' });
  const [row] = await db.insert(quickReplies).values({
    businessId: req.tenant!.businessId,
    shortcut: `/${shortcut}`,
    message: parsed.data.message,
    messageType: parsed.data.messageType,
    payload: parsed.data.payload,
    category: parsed.data.category,
  }).returning();
  res.json(row);
});

quickRepliesRouter.delete('/:id', async (req, res) => {
  await db.delete(quickReplies).where(and(eq(quickReplies.id, req.params.id), eq(quickReplies.businessId, req.tenant!.businessId)));
  res.json({ ok: true });
});
