import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '../db/client.js';
import { wabaSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { encryptSecret, maskSecret, decryptSecret } from '../services/crypto.js';
import { WhatsAppService, formatWhatsAppError } from '../services/whatsapp.js';

export const wabaRouter = Router();
wabaRouter.use(requireAuth);
const profileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function safeSecretMask(encrypted: string | null) {
  if (!encrypted) return null;
  try {
    return maskSecret(decryptSecret(encrypted));
  } catch {
    return 'saved but unreadable — enter a replacement';
  }
}

wabaRouter.get('/', async (req, res) => {
  const businessId = req.tenant!.businessId;
  const [row] = await db.select().from(wabaSettings).where(eq(wabaSettings.businessId, businessId)).limit(1);
  if (!row) return res.json(null);

  res.json({
    appId: row.appId,
    appSecretMasked: safeSecretMask(row.appSecretEnc),
    accessTokenMasked: safeSecretMask(row.accessTokenEnc),
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    webhookVerifyToken: row.webhookVerifyToken,
    apiVersion: row.apiVersion,
    connectionStatus: row.connectionStatus,
  });
});

async function getConfiguredClient(businessId: string) {
  const [row] = await db.select().from(wabaSettings).where(eq(wabaSettings.businessId, businessId)).limit(1);
  if (!row?.accessTokenEnc || !row.phoneNumberId || !row.wabaId) return null;
  return new WhatsAppService({
    accessToken: decryptSecret(row.accessTokenEnc),
    senderPhoneNumberId: row.phoneNumberId,
    WABA_ID: row.wabaId,
    appId: row.appId ?? undefined,
    apiVersion: row.apiVersion ?? 'v20.0',
  });
}

wabaRouter.get('/profile', async (req, res) => {
  const wa = await getConfiguredClient(req.tenant!.businessId);
  if (!wa) return res.status(400).json({ error: 'Configure the WABA access token, App ID, WABA ID, and phone number ID first.' });
  try {
    res.json(await wa.getBusinessProfile());
  } catch (err) {
    res.status(400).json({ error: formatWhatsAppError(err) });
  }
});

const profileSchema = z.object({
  about: z.string().max(139).optional(),
  address: z.string().max(256).optional(),
  description: z.string().max(512).optional(),
  email: z.string().email().max(128).optional().or(z.literal('')),
  vertical: z.enum(['', 'ALCOHOL', 'APPAREL', 'AUTO', 'BEAUTY', 'EDU', 'ENTERTAIN', 'EVENT_PLAN', 'FINANCE', 'GOVT', 'GROCERY', 'HEALTH', 'HOTEL', 'NONPROFIT', 'ONLINE_GAMBLING', 'OTC_DRUGS', 'OTHER', 'PHYSICAL_GAMBLING', 'PROF_SERVICES', 'RESTAURANT', 'RETAIL', 'TRAVEL']).optional(),
  websites: z.array(z.string().url().max(256)).max(2).optional(),
});

wabaRouter.put('/profile', requireRole('owner', 'admin'), async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const wa = await getConfiguredClient(req.tenant!.businessId);
  if (!wa) return res.status(400).json({ error: 'Configure the WhatsApp connection before editing the business profile.' });
  try {
    await wa.updateBusinessProfile(parsed.data);
    res.json(await wa.getBusinessProfile());
  } catch (err) {
    res.status(400).json({ error: formatWhatsAppError(err) });
  }
});

wabaRouter.post('/profile-picture', requireRole('owner', 'admin'), profileUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, JPEG, or PNG image first.' });
  if (!['image/jpeg', 'image/png'].includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Meta business profile pictures must be JPG or PNG images.' });
  }
  const wa = await getConfiguredClient(req.tenant!.businessId);
  if (!wa) return res.status(400).json({ error: 'Configure the WhatsApp connection before uploading a profile picture.' });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whatsapp-profile-'));
  const filePath = path.join(tempDir, req.file.originalname || 'profile.jpg');
  try {
    await fs.writeFile(filePath, req.file.buffer);
    const handle = await wa.uploadBusinessProfilePicture(filePath, req.file.mimetype, req.file.originalname || 'profile.jpg');
    await wa.updateBusinessProfile({ profilePictureHandle: handle });
    res.json(await wa.getBusinessProfile());
  } catch (err) {
    res.status(400).json({ error: formatWhatsAppError(err) });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

const updateSchema = z.object({
  appId: z.string().optional(),
  appSecret: z.string().optional(), // plaintext in, encrypted at rest
  accessToken: z.string().optional(),
  wabaId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  displayPhoneNumber: z.string().optional(),
  webhookVerifyToken: z.string().optional(),
  apiVersion: z.string().optional(),
});

wabaRouter.put('/', requireRole('owner', 'admin'), async (req, res) => {
  const businessId = req.tenant!.businessId;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const body = parsed.data;

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (body.appId !== undefined) update.appId = body.appId;
  if (body.appSecret) update.appSecretEnc = encryptSecret(body.appSecret);
  if (body.accessToken) update.accessTokenEnc = encryptSecret(body.accessToken);
  if (body.wabaId !== undefined) update.wabaId = body.wabaId;
  if (body.phoneNumberId !== undefined) update.phoneNumberId = body.phoneNumberId;
  if (body.displayPhoneNumber !== undefined) update.displayPhoneNumber = body.displayPhoneNumber;
  if (body.webhookVerifyToken !== undefined) update.webhookVerifyToken = body.webhookVerifyToken;
  if (body.apiVersion !== undefined) update.apiVersion = body.apiVersion;

  await db.update(wabaSettings).set(update).where(eq(wabaSettings.businessId, businessId));
  res.json({ ok: true });
});

// Sends a test text message to verify the credentials actually work end-to-end.
wabaRouter.post('/test-connection', requireRole('owner', 'admin'), async (req, res) => {
  const businessId = req.tenant!.businessId;
  const { testRecipientPhone } = req.body as { testRecipientPhone?: string };
  const [row] = await db.select().from(wabaSettings).where(eq(wabaSettings.businessId, businessId)).limit(1);

  if (!row?.accessTokenEnc || !row.phoneNumberId || !row.wabaId) {
    await db.update(wabaSettings).set({ connectionStatus: 'not_connected' }).where(eq(wabaSettings.businessId, businessId));
    return res.status(400).json({ status: 'not_connected', error: 'Missing access token, WABA ID, or phone number ID.' });
  }

  try {
    const wa = new WhatsAppService({
      accessToken: decryptSecret(row.accessTokenEnc),
      senderPhoneNumberId: row.phoneNumberId,
      WABA_ID: row.wabaId,
      appId: row.appId ?? undefined,
      apiVersion: row.apiVersion ?? 'v20.0',
    });
    if (testRecipientPhone) {
      await wa.sendText(testRecipientPhone, 'This is a test message from your WhatsApp support platform. Setup looks good! ✅');
    }
    await wa.verifyCredentials();
    await db.update(wabaSettings).set({ connectionStatus: 'connected' }).where(eq(wabaSettings.businessId, businessId));
    res.json({ status: 'connected' });
  } catch (err) {
    await db.update(wabaSettings).set({ connectionStatus: 'api_error' }).where(eq(wabaSettings.businessId, businessId));
    res.status(400).json({ status: 'api_error', error: formatWhatsAppError(err) });
  }
});
