import { Router } from 'express';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { ensureDefaultTenant } from '../services/defaultTenant.js';

// Signup/login/logout are gone — there's nothing to authenticate against anymore. /me is kept
// (same response shape as before) purely so the client's existing "who am I" check on load still
// works, but it now always resolves to the one default tenant instead of ever failing with 401.
export const authRouter = Router();

authRouter.get('/me', async (req, res) => {
  const { businessId, userId } = await ensureDefaultTenant();
  req.session.businessId = businessId;
  req.session.userId = userId;
  req.session.role = 'owner';
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, businessId: user.businessId } });
});
