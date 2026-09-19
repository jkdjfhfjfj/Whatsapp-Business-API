import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '../db/client.js';
import { media, messages } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../auth/middleware.js';
import { getWhatsAppClientForBusiness } from '../services/getWhatsAppClient.js';
import { saveMedia, readMedia, activeStorageProvider } from '../services/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only used by the 'local' storage provider — see services/storage.ts for the 'github'
// alternative. In production, set MEDIA_STORAGE_DIR to a Render Persistent Disk mount path
// (e.g. /var/data/media); Render's own filesystem is ephemeral and wiped on every
// deploy/restart, which would silently delete customer media otherwise.
export const MEDIA_STORAGE_DIR = process.env.MEDIA_STORAGE_DIR
  ?? path.join(__dirname, '..', '..', 'media-storage');
fs.mkdirSync(MEDIA_STORAGE_DIR, { recursive: true });

// Files are held in memory only long enough to hand off to the storage provider (disk write or
// GitHub commit) — never written to a temp path first, so there's nothing stray to clean up.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB, matches Meta's document limit ballpark
});

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.get('/storage-info', (_req, res) => {
  res.json({ provider: activeStorageProvider });
});

// Agent uploads a file to attach to an outbound message. Returns a media record whose
// storagePath + storageProvider the /api/messages/* send routes resolve into a sendable file.
uploadsRouter.post('/', upload.single('file'), async (req, res) => {
  const businessId = req.session.businessId!;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    const { storagePath, provider } = await saveMedia(req.file.buffer, req.file.originalname, MEDIA_STORAGE_DIR);
    const [row] = await db
      .insert(media)
      .values({
        businessId,
        direction: 'outbound',
        mimeType: req.file.mimetype,
        filename: req.file.originalname,
        sizeBytes: req.file.size,
        storagePath,
        storageProvider: provider,
      })
      .returning();
    res.json(row);
  } catch (err) {
    res.status(502).json({ error: `Could not save upload: ${(err as Error).message}` });
  }
});

// Streams a media file back to the browser (used both for outbound attachments the agent just
// uploaded and for inbound media once it's been downloaded/cached by the route below). Works
// the same regardless of storage provider — the browser never talks to GitHub directly.
uploadsRouter.get('/:id/content', async (req, res) => {
  const businessId = req.session.businessId!;
  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, req.params.id), eq(media.businessId, businessId)))
    .limit(1);
  if (!row) return res.status(404).json({ error: 'Media not found.' });

  try {
    const buffer = await readMedia(row.storagePath, row.storageProvider);
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ error: `Could not read media: ${(err as Error).message}` });
  }
});

// Lazily downloads and caches an inbound message's media from Meta the first time it's viewed
// (Meta's own media URLs expire quickly, so we don't store those directly). Subsequent requests
// serve the saved copy via the route above.
uploadsRouter.get('/for-message/:messageId', async (req, res) => {
  const businessId = req.session.businessId!;

  const existing = await db
    .select()
    .from(media)
    .where(and(eq(media.messageId, req.params.messageId), eq(media.businessId, businessId)))
    .limit(1);
  if (existing[0]) return res.json(existing[0]);

  const [msg] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, req.params.messageId), eq(messages.businessId, businessId)))
    .limit(1);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });

  const whatsappMediaId = (msg.content as { id?: string }).id;
  if (!whatsappMediaId) return res.status(400).json({ error: 'This message has no downloadable media.' });

  const wa = await getWhatsAppClientForBusiness(businessId);
  if (!wa) return res.status(400).json({ error: 'WhatsApp is not configured for this business.' });

  try {
    const { buffer, mimeType } = await wa.downloadMedia(whatsappMediaId);
    const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
    const { storagePath, provider } = await saveMedia(buffer, `inbound.${ext}`, MEDIA_STORAGE_DIR);

    const [row] = await db
      .insert(media)
      .values({
        businessId,
        messageId: msg.id,
        direction: 'inbound',
        mimeType,
        filename: `inbound.${ext}`,
        sizeBytes: buffer.length,
        storagePath,
        storageProvider: provider,
        whatsappMediaId,
      })
      .returning();

    res.json(row);
  } catch (err) {
    res.status(502).json({ error: `Could not download media from Meta: ${(err as Error).message}` });
  }
});
