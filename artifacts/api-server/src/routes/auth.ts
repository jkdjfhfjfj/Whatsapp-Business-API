import { Router } from 'express';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { ensureDefaultTenant } from '../services/defaultTenant.js';

// /me is kept as a workspace bootstrap endpoint. It does not authenticate a browser session.
export const authRouter = Router();

authRouter.get('/me', async (req, res) => {
  const { businessId, userId } = await ensureDefaultTenant();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, businessId: user.businessId } });
});
