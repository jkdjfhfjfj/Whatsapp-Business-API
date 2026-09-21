import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../db/client.js';
import { businesses, users, aiSettings, wabaSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { encryptSecret } from './crypto.js';

// Authentication has been removed: anyone with the URL gets in. There is no login to establish
// "which business/user this request belongs to" anymore, so every request is attached to one
// auto-created default business/user instead. This keeps the rest of the codebase (which is
// Routes are still scoped through the request tenant context, but no browser session or login is
// needed in this single-workspace deployment.
const DEFAULT_BUSINESS_NAME = process.env.DEFAULT_BUSINESS_NAME ?? 'My Business';

let cached: { businessId: string; userId: string } | null = null;

export async function ensureDefaultTenant(): Promise<{ businessId: string; userId: string }> {
  if (cached) return cached;

  const [existingBusiness] = await db.select().from(businesses).limit(1);
  let business = existingBusiness;

  if (!business) {
    [business] = await db.insert(businesses).values({ name: DEFAULT_BUSINESS_NAME }).returning();
    // Seed default AI + WABA settings rows, same as signup used to, so Settings has something
    // to edit immediately.
    await db.insert(aiSettings).values({
      businessId: business.id,
      enabled: Boolean(process.env.GROQ_API_KEY),
      ...(process.env.GROQ_API_KEY ? { groqApiKeyEnc: encryptSecret(process.env.GROQ_API_KEY) } : {}),
    });
    await db.insert(wabaSettings).values({ businessId: business.id });
  }

  // Existing single-workspace deployments may have an empty AI row from before the
  // environment key was configured. Seed it once without overwriting a key saved in Settings.
  const [existingAiSettings] = await db.select().from(aiSettings).where(eq(aiSettings.businessId, business.id)).limit(1);
  if (existingAiSettings && !existingAiSettings.groqApiKeyEnc && process.env.GROQ_API_KEY) {
    await db.update(aiSettings).set({
      enabled: true,
      groqApiKeyEnc: encryptSecret(process.env.GROQ_API_KEY),
      updatedAt: new Date(),
    }).where(eq(aiSettings.id, existingAiSettings.id));
  }

  let [user] = await db.select().from(users).where(eq(users.businessId, business.id)).limit(1);
  if (!user) {
    // A password hash is still required by the column, but it's unusable (random, never
    // surfaced anywhere) since there's no login form to check it against.
    const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
    [user] = await db
      .insert(users)
      .values({ name: 'Team', email: `${business.id}@no-auth.local`, passwordHash, role: 'owner', businessId: business.id })
      .returning();
  }

  cached = { businessId: business.id, userId: user.id };
  return cached;
}

export function getDefaultTenant(): { businessId: string; userId: string } {
  if (!cached) {
    throw new Error('Default tenant not initialized yet — ensureDefaultTenant() must be awaited before the server starts accepting requests.');
  }
  return cached;
}
