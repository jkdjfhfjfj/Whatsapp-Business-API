const MEDIA_TYPES = ['image', 'video', 'audio', 'document'] as const;

export type MediaMessageType = typeof MEDIA_TYPES[number];

export function normalizedMessageType(message: any): string {
  const rawType = message?.type;

  if (rawType === 'text_message' || rawType === 'ad_message' || rawType === 'text') return 'text';
  if (rawType === 'audio_message') return 'audio';
  if (rawType === 'sticker_message') return 'image';
  if (rawType === 'location_message') return 'location';
  if (rawType === 'contact_message') return 'contact';
  if (rawType === 'quick_reply_message' || rawType === 'simple_button_message') return 'button';
  if (rawType === 'radio_button_message') return 'list';
  if (rawType === 'template_message' || rawType === 'message_template' || rawType === 'template') return 'template';

  if (rawType === 'media_message') {
    const mediaType = MEDIA_TYPES.find((kind) => mediaContent(message, kind));
    return mediaType ?? 'unknown';
  }

  return rawType ?? 'unknown';
}

export function mediaContent(message: any, type?: MediaMessageType): Record<string, any> {
  const content = message?.content ?? {};
  const body = content?.body ?? {};
  const mediaType = type ?? (normalizedMessageType(message) as MediaMessageType);

  if (MEDIA_TYPES.includes(mediaType) && content?.[mediaType] && typeof content[mediaType] === 'object') {
    return content[mediaType];
  }
  if (MEDIA_TYPES.includes(mediaType) && body?.[mediaType] && typeof body[mediaType] === 'object') {
    return body[mediaType];
  }
  return content;
}

export function messageText(message: any): string {
  const content = message?.content ?? {};
  const text = content?.text;
  if (typeof text === 'string') return text;
  if (text && typeof text.body === 'string') return text.body;
  if (typeof content?.body?.text === 'string') return content.body.text;
  return '';
}