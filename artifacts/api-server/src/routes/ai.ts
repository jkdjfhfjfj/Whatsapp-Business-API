import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { aiSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { encryptSecret, maskSecret, decryptSecret } from '../services/crypto.js';
import { testGroqKey, listGroqModels, compileSystemPrompt } from '../services/groq.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.get('/', async (req, res) => {
  const businessId = req.session.businessId!;
  const [row] = await db.select().from(aiSettings).where(eq(aiSettings.businessId, businessId)).limit(1);
  if (!row) return res.json(null);

  res.json({
    enabled: row.enabled,
    provider: row.provider,
    groqApiKeyMasked: row.groqApiKeyEnc ? maskSecret(decryptSecret(row.groqApiKeyEnc)) : null,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    topP: row.topP,
    systemPrompt: row.systemPrompt,
    businessContext: row.businessContext,
    restrictedTopics: row.restrictedTopics,
    pauseAfterHumanReply: row.pauseAfterHumanReply,
    compiledPromptPreview: compileSystemPrompt({
      systemPrompt: row.systemPrompt,
      businessContext: row.businessContext,
      restrictedTopics: row.restrictedTopics,
    }),
  });
});

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  groqApiKey: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(4096).optional(),
  topP: z.number().min(0).max(1).optional(),
  systemPrompt: z.string().optional(),
  businessContext: z.string().optional(),
  restrictedTopics: z.string().optional(),
  pauseAfterHumanReply: z.boolean().optional(),
});

aiRouter.put('/', requireRole('owner', 'admin'), async (req, res) => {
  const businessId = req.session.businessId!;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const body = parsed.data;

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.groqApiKey) update.groqApiKeyEnc = encryptSecret(body.groqApiKey);
  if (body.model !== undefined) update.model = body.model;
  if (body.temperature !== undefined) update.temperature = body.temperature;
  if (body.maxTokens !== undefined) update.maxTokens = body.maxTokens;
  if (body.topP !== undefined) update.topP = body.topP;
  if (body.systemPrompt !== undefined) update.systemPrompt = body.systemPrompt;
  if (body.businessContext !== undefined) update.businessContext = body.businessContext;
  if (body.restrictedTopics !== undefined) update.restrictedTopics = body.restrictedTopics;
  if (body.pauseAfterHumanReply !== undefined) update.pauseAfterHumanReply = body.pauseAfterHumanReply;

  await db.update(aiSettings).set(update).where(eq(aiSettings.businessId, businessId));
  res.json({ ok: true });
});

aiRouter.post('/test-key', requireRole('owner', 'admin'), async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required.' });
  const ok = await testGroqKey(apiKey);
  res.json({ ok });
});

aiRouter.get('/models', requireRole('owner', 'admin'), async (req, res) => {
  const businessId = req.session.businessId!;
  const [row] = await db.select().from(aiSettings).where(eq(aiSettings.businessId, businessId)).limit(1);
  if (!row?.groqApiKeyEnc) return res.status(400).json({ error: 'No Groq API key saved yet.' });
  try {
    const models = await listGroqModels(decryptSecret(row.groqApiKeyEnc));
    res.json({ models });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
