import { db } from '../db/client.js';
import { aiSettings, messages, aiUsage } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { decryptSecret } from './crypto.js';
import { compileSystemPrompt, generateReply, type GroqChatMessage } from './groq.js';
import type { WhatsAppService } from './whatsapp.js';
import { formatWhatsAppError } from './whatsapp.js';
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

  if (settings.pauseAfterHumanReply) {
    const latestHumanReply = recentMessages.find((message) => message.direction === 'outbound' && message.senderType === 'agent');
    const latestInbound = recentMessages.find((message) => message.direction === 'inbound');
    if (latestHumanReply && latestInbound && latestHumanReply.createdAt > latestInbound.createdAt) return;
  }

  const history: GroqChatMessage[] = recentMessages
    .reverse()
    .filter((m) => m.type === 'text' || m.type === 'text_message' || m.type === 'ad_message')
    .map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: getTextContent(m.content),
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

  try {
    await wa.sendText(recipientPhone, reply.content);
  } catch (err) {
    const errorMessage = formatWhatsAppError(err);
    console.error('AI WhatsApp send failed:', errorMessage);
    const [failed] = await db
      .insert(messages)
      .values({
        conversationId,
        businessId,
        direction: 'outbound',
        senderType: 'ai',
        type: 'text',
        content: { text: reply.content },
        status: 'failed',
        errorMessage,
      })
      .returning();
    broadcastToBusiness(businessId, 'message:new', failed);
    return;
  }

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

function getTextContent(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const value = content as { text?: unknown; body?: { text?: unknown } };
  if (typeof value.text === 'string') return value.text;
  if (value.text && typeof value.text === 'object' && typeof (value.text as { body?: unknown }).body === 'string') {
    return (value.text as { body: string }).body;
  }
  return typeof value.body?.text === 'string' ? value.body.text : '';
}
