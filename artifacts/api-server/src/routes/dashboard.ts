import { Router } from 'express';
import { db } from '../db/client.js';
import { conversations, messages } from '../db/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/', async (req, res) => {
  const businessId = req.session.businessId!;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${conversations.status} = 'open')::int`,
      pending: sql<number>`count(*) filter (where ${conversations.status} = 'pending')::int`,
      resolved: sql<number>`count(*) filter (where ${conversations.status} = 'resolved')::int`,
      unread: sql<number>`count(*) filter (where ${conversations.unreadCount} > 0)::int`,
      aiHandled: sql<number>`count(*) filter (where ${conversations.aiEnabled} = true)::int`,
    })
    .from(conversations)
    .where(eq(conversations.businessId, businessId));

  const [messageCounts] = await db
    .select({
      today: sql<number>`count(*) filter (where ${messages.createdAt} >= ${startOfToday})::int`,
      last7Days: sql<number>`count(*) filter (where ${messages.createdAt} >= ${sevenDaysAgo})::int`,
      aiReplies: sql<number>`count(*) filter (where ${messages.senderType} = 'ai')::int`,
      agentReplies: sql<number>`count(*) filter (where ${messages.senderType} = 'agent')::int`,
      failed: sql<number>`count(*) filter (where ${messages.status} = 'failed')::int`,
    })
    .from(messages)
    .where(and(eq(messages.businessId, businessId), gte(messages.createdAt, sevenDaysAgo)));

  // Simple 7-day daily volume for a chart on the frontend.
  const daily = await db
    .select({
      day: sql<string>`to_char(${messages.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(messages)
    .where(and(eq(messages.businessId, businessId), gte(messages.createdAt, sevenDaysAgo)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  res.json({ conversations: counts, messages: messageCounts, dailyVolume: daily });
});
