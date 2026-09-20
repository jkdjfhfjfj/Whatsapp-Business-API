import type { Request, Response, NextFunction } from 'express';
import { getDefaultTenant } from '../services/defaultTenant.js';

declare global {
  namespace Express {
    interface Request {
      tenant?: {
        businessId: string;
        userId: string;
        role: string;
      };
    }
  }
}

// Authentication is intentionally disabled for this single-workspace deployment. Every request
// is scoped to the one default tenant and does not depend on cookies, sessions, or a login screen.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const { businessId, userId } = getDefaultTenant();
  req.tenant = { businessId, userId, role: 'owner' };
  next();
}

// No roles to check anymore — every visitor has full access. Kept as a no-op (rather than
// deleted) so route files that still call requireRole('owner', 'admin') don't need editing.
export function requireRole(..._roles: string[]) {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}
