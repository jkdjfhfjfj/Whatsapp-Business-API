import { db } from '../db/client.js';
import { aiSettings, conversations, messages, aiUsage } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { decryptSecret } from './crypto.js';
import { compileSystemPrompt, generateReply, type GroqChatMessage } from './groq.js';
import type { WhatsAppService } from './whatsapp.js';
import { formatWhatsAppError } from './whatsapp.js';
import { broadcastToBusiness } from './websocket.js';

const HISTORY_LIMIT = 12;
const activeReplies = new Set<string>();

export async function maybeGenerateAiReply(opts: {
  businessId: string;
  conversationId: string;
  recipientPhone: string;
  wa: WhatsAppService;
}) {
  const { businessId, conversationId, recipientPhone, wa } = opts;

  if (activeReplies.has(conversationId)) {
    console.info(`[ai] skipped duplicate reply for conversation ${conversationId}`);
    return;
  }

  const [settings] = await db.select().from(aiSettings).where(eq(aiSettings.businessId, businessId)).limit(1);
  if (!settings?.enabled) {
    console.info(`[ai] disabled for business ${businessId}`);
    return;
  }
  if (!settings.groqApiKeyEnc) {
    console.error(`[ai] enabled without a Groq API key for business ${businessId}`);
    return;
  }

  activeReplies.add(conversationId);
  try {
    const recentMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(HISTORY_LIMIT);

    if (settings.pauseAfterHumanReply) {
      const latestHumanReply = recentMessages.find((message) => message.direction === 'outbound' && message.senderType === 'agent');
      const latestInbound = recentMessages.find((message) => message.direction === 'inbound');
      if (latestHumanReply && latestInbound && latestHumanReply.createdAt > latestInbound.createdAt) {
        console.info(`[ai] paused after human reply for conversation ${conversationId}`);
        return;
      }
    }

    const [conversation] = await db
      .select({ aiEnabled: conversations.aiEnabled })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conversation?.aiEnabled) {
      console.info(`[ai] human takeover is active for conversation ${conversationId}`);
      return;
    }

    const history: GroqChatMessage[] = recentMessages
      .reverse()
      .filter((m) => m.type === 'text' || m.type === 'text_message' || m.type === 'ad_message')
      .map((m): GroqChatMessage => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: getTextContent(m.content),
      }))
      .filter((m) => m.content.trim().length > 0);

    if (!history.some((message) => message.role === 'user')) {
      console.info(`[ai] no text customer message available for conversation ${conversationId}`);
      return;
    }

    const systemPrompt = compileSystemPrompt({
      systemPrompt: settings.systemPrompt,
      businessContext: settings.businessContext,
      restrictedTopics: settings.restrictedTopics,
    });

    let reply;
    try {
      const apiKey = decryptSecret(settings.groqApiKeyEnc);
      reply = await generateReply(
        { apiKey, model: settings.model, temperature: settings.temperature, maxTokens: settings.maxTokens, topP: settings.topP },
        [{ role: 'system', content: systemPrompt }, ...history],
      );
    } catch (err) {
      console.error(`[ai] reply generation failed for conversation ${conversationId}:`, (err as Error).message);
      return;
    }

    if (!reply.content.trim()) {
      console.error(`[ai] provider returned an empty reply for conversation ${conversationId}`);
      return;
    }

    // A human can reply while generation is in flight. Re-check the conversation flag
    // immediately before sending so the generated response cannot overtake the handoff.
    const [beforeSend] = await db
      .select({ aiEnabled: conversations.aiEnabled })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!beforeSend?.aiEnabled) {
      console.info(`[ai] discarded generated reply after human takeover for conversation ${conversationId}`);
      return;
    }

    let whatsappMessageId: string | undefined;
    try {
      const response = await wa.sendText(recipientPhone, reply.content) as { messages?: { id?: string }[] };
      whatsappMessageId = response?.messages?.[0]?.id;
    } catch (err) {
      const errorMessage = formatWhatsAppError(err);
      console.error(`[ai] WhatsApp send failed for conversation ${conversationId}:`, errorMessage);
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
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
      broadcastToBusiness(businessId, 'message:new', failed);
      broadcastToBusiness(businessId, 'conversation:update', { id: conversationId, conversationId });
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
        whatsappMessageId,
        status: 'sent',
      })
      .returning();

    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

    await db.insert(aiUsage).values({
      businessId,
      conversationId,
      promptTokens: reply.promptTokens,
      completionTokens: reply.completionTokens,
      model: settings.model,
    });

    broadcastToBusiness(businessId, 'message:new', saved);
    broadcastToBusiness(businessId, 'conversation:update', { id: conversationId, conversationId });
  } finally {
    activeReplies.delete(conversationId);
  }
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
