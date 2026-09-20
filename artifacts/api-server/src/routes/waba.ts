import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { wabaSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { encryptSecret, maskSecret, decryptSecret } from '../services/crypto.js';
import { WhatsAppService, formatWhatsAppError } from '../services/whatsapp.js';

export const wabaRouter = Router();
wabaRouter.use(requireAuth);

wabaRouter.get('/', async (req, res) => {
  const businessId = req.session.businessId!;
  const [row] = await db.select().from(wabaSettings).where(eq(wabaSettings.businessId, businessId)).limit(1);
  if (!row) return res.json(null);

  res.json({
    appId: row.appId,
    appSecretMasked: row.appSecretEnc ? maskSecret(decryptSecret(row.appSecretEnc)) : null,
    accessTokenMasked: row.accessTokenEnc ? maskSecret(decryptSecret(row.accessTokenEnc)) : null,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    webhookVerifyToken: row.webhookVerifyToken,
    apiVersion: row.apiVersion,
    connectionStatus: row.connectionStatus,
  });
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
  const businessId = req.session.businessId!;
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
  const businessId = req.session.businessId!;
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
