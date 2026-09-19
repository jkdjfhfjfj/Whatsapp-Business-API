// Groq is the AI provider, called via its OpenAI-compatible /chat/completions endpoint.
// This is deliberately behind a small interface (generateReply) so a future provider can be
// swapped in without touching bot/automation logic elsewhere in the app.

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqSettings {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
}

export interface GroqReply {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export async function listGroqModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${GROQ_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Groq models request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m: { id: string }) => m.id);
}

export async function testGroqKey(apiKey: string): Promise<boolean> {
  try {
    await listGroqModels(apiKey);
    return true;
  } catch {
    return false;
  }
}

export async function generateReply(
  settings: GroqSettings,
  messages: GroqChatMessage[],
): Promise<GroqReply> {
  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      top_p: settings.topP,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq chat completion failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

// Compiles the structured AI settings (system prompt + business context + restricted topics)
// into the final system message sent to Groq. Mirrors the "compiled system prompt preview"
// shown in the Settings UI.
export function compileSystemPrompt(opts: {
  systemPrompt: string;
  businessContext?: string | null;
  restrictedTopics?: string | null;
}): string {
  const parts = [opts.systemPrompt.trim()];
  if (opts.businessContext?.trim()) {
    parts.push(`Business context:\n${opts.businessContext.trim()}`);
  }
  if (opts.restrictedTopics?.trim()) {
    parts.push(`Never discuss or speculate about: ${opts.restrictedTopics.trim()}.`);
  }
  parts.push(
    'If you are not confident in an answer, or the customer asks about something sensitive ' +
    '(billing disputes, account security, legal matters), say you will connect them with a ' +
    'human agent instead of guessing.'
  );
  return parts.join('\n\n');
}
