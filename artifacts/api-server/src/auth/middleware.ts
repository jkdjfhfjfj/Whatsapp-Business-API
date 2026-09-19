import type { Request, Response, NextFunction } from 'express';
import { getDefaultTenant } from '../services/defaultTenant.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    businessId?: string;
    role?: string;
  }
}

// Authentication removed: anyone with the URL is treated as the (single) default tenant's
// owner. This used to reject requests with no valid session (401); now it self-heals every
// request onto the default business/user instead, so every route downstream that reads
// req.session.businessId / userId keeps working unchanged.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.businessId || !req.session.userId) {
    const { businessId, userId } = getDefaultTenant();
    req.session.businessId = businessId;
    req.session.userId = userId;
    req.session.role = req.session.role ?? 'owner';
  }
  next();
}

// No roles to check anymore — every visitor has full access. Kept as a no-op (rather than
// deleted) so route files that still call requireRole('owner', 'admin') don't need editing.
export function requireRole(..._roles: string[]) {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}
