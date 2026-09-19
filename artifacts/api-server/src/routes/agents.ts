import { Router } from 'express';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';

export const agentsRouter = Router();
agentsRouter.use(requireAuth);

agentsRouter.get('/', async (req, res) => {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.businessId, req.session.businessId!));
  res.json(rows);
});
