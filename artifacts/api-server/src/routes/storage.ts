import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { storageSettings } from '../db/schema.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { encryptSecret, maskSecret } from '../services/crypto.js';
import { getStorageConfig, testCloudinary, type StorageProvider } from '../services/storage.js';

export const storageRouter = Router();
storageRouter.use(requireAuth);

const providerSchema = z.enum(['local', 'github', 'cloudinary']);
const updateSchema = z.object({
  provider: providerSchema,
  cloudName: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
});

function publicStorageConfig(config: Awaited<ReturnType<typeof getStorageConfig>>) {
  return {
    provider: config.provider,
    cloudName: config.cloudName ?? '',
    apiKey: config.apiKey ?? '',
    apiSecretMasked: config.apiSecret ? maskSecret(config.apiSecret) : null,
  };
}

storageRouter.get('/', async (req, res) => {
  res.json(publicStorageConfig(await getStorageConfig(req.tenant!.businessId)));
});

storageRouter.put('/', requireRole('owner', 'admin'), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const businessId = req.tenant!.businessId;
  const current = await getStorageConfig(businessId);
  const body = parsed.data;
  const merged = {
    provider: body.provider as StorageProvider,
    cloudName: body.cloudName ?? current.cloudName,
    apiKey: body.apiKey ?? current.apiKey,
    apiSecret: body.apiSecret ?? current.apiSecret,
  };
  if (merged.provider === 'cloudinary' && (!merged.cloudName || !merged.apiKey || !merged.apiSecret)) {
    return res.status(400).json({ error: 'Cloudinary requires a cloud name, API key, and API secret.' });
  }

  const [existing] = await db.select().from(storageSettings).where(eq(storageSettings.businessId, businessId)).limit(1);
  const values = {
    businessId,
    provider: merged.provider,
    cloudName: merged.cloudName ?? null,
    apiKey: merged.apiKey ?? null,
    ...(body.apiSecret ? { apiSecretEnc: encryptSecret(body.apiSecret) } : {}),
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(storageSettings).set(values).where(and(eq(storageSettings.id, existing.id), eq(storageSettings.businessId, businessId)));
  } else {
    await db.insert(storageSettings).values({
      ...values,
      apiSecretEnc: body.apiSecret ? encryptSecret(body.apiSecret) : null,
    });
  }
  res.json({ ok: true });
});

storageRouter.post('/test', requireRole('owner', 'admin'), async (req, res) => {
  const parsed = updateSchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const current = await getStorageConfig(req.tenant!.businessId);
  const body = parsed.data;
  const config = {
    provider: (body.provider ?? current.provider) as StorageProvider,
    cloudName: body.cloudName ?? current.cloudName,
    apiKey: body.apiKey ?? current.apiKey,
    apiSecret: body.apiSecret ?? current.apiSecret,
  };
  if (config.provider !== 'cloudinary') return res.json({ status: 'connected' });
  try {
    await testCloudinary(config);
    res.json({ status: 'connected' });
  } catch (err) {
    res.status(400).json({ status: 'api_error', error: (err as Error).message });
  }
});