import { db } from '../db/client.js';
import { aiSettings, messages, aiUsage } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { decryptSecret } from './crypto.js';
import { compileSystemPrompt, generateReply, type GroqChatMessage } from './groq.js';
import type { WhatsAppService } from './whatsapp.js';
import { broadcastToBusiness } from './websocket.js';

const HISTORY_LIMIT = 12;

export async function maybeGenerateAiReply(opts: {
  businessId: string;
  conversationId: string;
  recipientPhone: string;
  wa: WhatsAppService;
}) {
  const { businessId, conversationId, recipientPhone, wa } = opts;

  const [settings] = await db.select().from(aiSettings).where(eq(aiSettings.businessId, businessId)).limit(1);
  if (!settings?.enabled || !settings.groqApiKeyEnc) return;

  const recentMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY_LIMIT);

  const history: GroqChatMessage[] = recentMessages
    .reverse()
    .filter((m) => m.type === 'text')
    .map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: (m.content as { text?: string }).text ?? '',
    }));

  const systemPrompt = compileSystemPrompt({
    systemPrompt: settings.systemPrompt,
    businessContext: settings.businessContext,
    restrictedTopics: settings.restrictedTopics,
  });

  const apiKey = decryptSecret(settings.groqApiKeyEnc);

  let reply;
  try {
    reply = await generateReply(
      { apiKey, model: settings.model, temperature: settings.temperature, maxTokens: settings.maxTokens, topP: settings.topP },
      [{ role: 'system', content: systemPrompt }, ...history],
    );
  } catch (err) {
    console.error('Groq reply generation failed:', (err as Error).message);
    return;
  }

  if (!reply.content.trim()) return;

  await wa.sendText(recipientPhone, reply.content);

  const [saved] = await db
    .insert(messages)
    .values({
      conversationId,
      businessId,
      direction: 'outbound',
      senderType: 'ai',
      type: 'text',
      content: { text: reply.content },
      status: 'sent',
    })
    .returning();

  await db.insert(aiUsage).values({
    businessId,
    conversationId,
    promptTokens: reply.promptTokens,
    completionTokens: reply.completionTokens,
    model: settings.model,
  });

  broadcastToBusiness(businessId, 'message:new', saved);
}
