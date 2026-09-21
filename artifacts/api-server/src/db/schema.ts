import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('owner'), // owner|admin|manager|agent|viewer
  businessId: uuid('business_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_idx').on(t.email),
}));

export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Encrypted Meta WABA credentials + AI (Groq) settings for a business.
export const wabaSettings = pgTable('waba_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  // Meta credentials — stored as AES-256-GCM ciphertext strings ("iv:tag:ciphertext" base64).
  appId: text('app_id'),
  appSecretEnc: text('app_secret_enc'),
  accessTokenEnc: text('access_token_enc'),
  wabaId: text('waba_id'),
  phoneNumberId: text('phone_number_id'),
  displayPhoneNumber: text('display_phone_number'),
  webhookVerifyToken: text('webhook_verify_token'),
  apiVersion: text('api_version').default('v20.0'),
  connectionStatus: text('connection_status').default('not_connected'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const storageSettings = pgTable('storage_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  provider: text('provider').notNull().default('local'), // local|github|cloudinary
  cloudName: text('cloud_name'),
  apiKey: text('api_key'),
  apiSecretEnc: text('api_secret_enc'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const aiSettings = pgTable('ai_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  provider: text('provider').notNull().default('groq'),
  groqApiKeyEnc: text('groq_api_key_enc'),
  model: text('model').notNull().default('llama-3.3-70b-versatile'),
  temperature: real('temperature').notNull().default(0.4),
  maxTokens: integer('max_tokens').notNull().default(400),
  topP: real('top_p').notNull().default(1),
  systemPrompt: text('system_prompt').notNull().default(
    'You are a helpful, concise customer support assistant. Never invent pricing, order status, or policies you have not been given. Escalate anything you are unsure about.'
  ),
  businessContext: text('business_context').default(''),
  restrictedTopics: text('restricted_topics').default(''),
  pauseAfterHumanReply: boolean('pause_after_human_reply').notNull().default(true),
  humanHandoffMessage: text('human_handoff_message').notNull().default('A human agent has joined the conversation and will take over from here.'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  waId: text('wa_id').notNull(), // WhatsApp phone id, digits only, no '+'
  waName: text('wa_name'), // read-only, synced from Meta
  waProfilePhotoUrl: text('wa_profile_photo_url'),
  name: text('name'), // business-owned override / CRM name
  email: text('email'),
  company: text('company'),
  language: text('language'),
  timezone: text('timezone'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastContactAt: timestamp('last_contact_at'),
}, (t) => ({
  waIdIdx: uniqueIndex('contacts_business_waid_idx').on(t.businessId, t.waId),
}));

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  status: text('status').notNull().default('open'), // open|pending|resolved|archived
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  assignedAgentId: uuid('assigned_agent_id'),
  lastCustomerMessageAt: timestamp('last_customer_message_at'),
  windowExpiresAt: timestamp('window_expires_at'),
  unreadCount: integer('unread_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull(),
  businessId: uuid('business_id').notNull(),
  direction: text('direction').notNull(), // inbound|outbound
  senderType: text('sender_type').notNull(), // customer|agent|ai|bot|system
  senderId: uuid('sender_id'), // agent user id, if senderType = agent
  type: text('type').notNull(), // text|image|video|audio|document|location|contact|button|list|template
  content: jsonb('content').notNull(), // shape varies by type
  whatsappMessageId: text('whatsapp_message_id'),
  status: text('status').notNull().default('sent'), // sent|delivered|read|failed
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull(),
  authorId: uuid('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  name: text('name').notNull(),
  color: text('color').default('#22c55e'),
});

export const conversationTags = pgTable('conversation_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull(),
  tagId: uuid('tag_id').notNull(),
});

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventKey: text('event_key').notNull(), // dedupe key derived from Meta's payload
  businessId: uuid('business_id'),
  payload: jsonb('payload').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
}, (t) => ({
  eventKeyIdx: uniqueIndex('webhook_events_key_idx').on(t.eventKey),
}));

export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  conversationId: uuid('conversation_id'),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  model: text('model').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Uploaded / downloaded media files (outbound attachments the agent uploads, and inbound media
// downloaded from Meta and cached locally so it can be viewed without hitting Meta's expiring
// media URLs every time). `storageProvider` is 'local' in this scaffold; swap for 's3' etc.
// without touching callers if you move to object storage (see SPEC.md Section 12).
export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  messageId: uuid('message_id'),
  direction: text('direction').notNull(), // inbound|outbound
  mimeType: text('mime_type').notNull(),
  filename: text('filename').notNull(),
  sizeBytes: integer('size_bytes'),
  storageProvider: text('storage_provider').notNull().default('local'),
  storagePath: text('storage_path').notNull(), // local disk path or object-storage key
  whatsappMediaId: text('whatsapp_media_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const quickReplies = pgTable('quick_replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  shortcut: text('shortcut').notNull(), // e.g. "/hello"
  message: text('message').notNull(),
  messageType: text('message_type').notNull().default('text'), // text|buttons|list
  payload: jsonb('payload').notNull().default({}), // structured fields for buttons/lists
  category: text('category'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Local cache of Meta message templates. `metaStatus` reflects Meta's real approval state —
// never assume a template is usable just because it exists in this table.
export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull(),
  name: text('name').notNull(),
  category: text('category'),
  language: text('language').notNull().default('en_US'),
  metaTemplateId: text('meta_template_id'),
  metaStatus: text('meta_status').notNull().default('unknown'), // approved|pending|rejected|unknown
  components: jsonb('components').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
