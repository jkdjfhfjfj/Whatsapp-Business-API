import { db } from '../db/client.js';
import { wabaSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decryptSecret } from './crypto.js';
import { WhatsAppService } from './whatsapp.js';

export async function getWhatsAppClientForBusiness(businessId: string): Promise<WhatsAppService | null> {
  const [row] = await db.select().from(wabaSettings).where(eq(wabaSettings.businessId, businessId)).limit(1);
  if (!row?.accessTokenEnc || !row.phoneNumberId || !row.wabaId) return null;
  return new WhatsAppService({
    accessToken: decryptSecret(row.accessTokenEnc),
    senderPhoneNumberId: row.phoneNumberId,
    WABA_ID: row.wabaId,
    apiVersion: row.apiVersion ?? 'v20.0',
  });
}
