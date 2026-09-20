import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuid } from 'uuid';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { storageSettings } from '../db/schema.js';
import { decryptSecret } from './crypto.js';

export type StorageProvider = 'local' | 'github' | 'cloudinary';

export type StorageConfig = {
  provider: StorageProvider;
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
};

// The database-backed setting is preferred. Environment variables remain supported for
// deployments that want to configure storage without using the Settings screen.
const ENV_PROVIDER = (process.env.STORAGE_PROVIDER === 'github' || process.env.STORAGE_PROVIDER === 'cloudinary')
  ? process.env.STORAGE_PROVIDER
  : 'local';
export const activeStorageProvider = ENV_PROVIDER as StorageProvider;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_MEDIA_REPO;
const GITHUB_BRANCH = process.env.GITHUB_MEDIA_BRANCH || 'main';
const GITHUB_API = 'https://api.github.com';

const CACHE_DIR = path.join(os.tmpdir(), 'wa-platform-media-cache');
fsSync.mkdirSync(CACHE_DIR, { recursive: true });

function cachePathFor(storagePath: string) {
  return path.join(CACHE_DIR, Buffer.from(storagePath).toString('base64url'));
}

function slugify(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function sha1(value: string) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function cloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return sha1(`${serialized}${apiSecret}`);
}

function assertCloudinaryConfigured(config: StorageConfig) {
  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new Error('Cloudinary storage requires a cloud name, API key, and API secret.');
  }
}

function assertGithubConfigured() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    throw new Error(
      'STORAGE_PROVIDER=github requires GITHUB_TOKEN and GITHUB_MEDIA_REPO ("owner/repo") to be set.',
    );
  }
}

export async function getStorageConfig(businessId?: string): Promise<StorageConfig> {
  if (businessId) {
    const [row] = await db.select().from(storageSettings).where(eq(storageSettings.businessId, businessId)).limit(1);
    if (row) {
      return {
        provider: row.provider as StorageProvider,
        cloudName: row.cloudName ?? undefined,
        apiKey: row.apiKey ?? undefined,
        apiSecret: row.apiSecretEnc ? decryptSecret(row.apiSecretEnc) : undefined,
      };
    }
  }

  return {
    provider: activeStorageProvider,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  };
}

async function uploadToCloudinary(buffer: Buffer, originalFilename: string, config: StorageConfig) {
  assertCloudinaryConfigured(config);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const publicId = `whatsapp/${uuid()}-${slugify(path.parse(originalFilename).name)}`;
  const params = { public_id: publicId, timestamp };
  const form = new FormData();
  form.append('file', new Blob([Uint8Array.from(buffer)]), originalFilename);
  form.append('api_key', config.apiKey!);
  form.append('timestamp', timestamp);
  form.append('public_id', publicId);
  form.append('signature', cloudinarySignature(params, config.apiSecret!));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`, {
    method: 'POST',
    body: form,
  });
  const data = (await response.json().catch(() => ({}))) as {
    public_id?: string;
    resource_type?: string;
    error?: { message?: string };
  };
  if (!response.ok || !data.public_id) {
    throw new Error(`Cloudinary upload failed (${response.status}): ${data.error?.message ?? JSON.stringify(data)}`);
  }
  return `${data.resource_type ?? 'raw'}/${data.public_id}`;
}

async function destroyCloudinaryAsset(storagePath: string, config: StorageConfig) {
  assertCloudinaryConfigured(config);
  const [resourceType, ...publicIdParts] = storagePath.split('/');
  const publicId = publicIdParts.join('/');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = { public_id: publicId, timestamp };
  const form = new FormData();
  form.append('public_id', publicId);
  form.append('timestamp', timestamp);
  form.append('api_key', config.apiKey!);
  form.append('invalidate', 'true');
  form.append('signature', cloudinarySignature(params, config.apiSecret!));

  await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/destroy`, {
    method: 'POST',
    body: form,
  });
}

export async function testCloudinary(config: StorageConfig) {
  assertCloudinaryConfigured(config);
  const storagePath = await uploadToCloudinary(Buffer.from('WhatsApp support storage test\n'), 'storage-test.txt', config);
  await destroyCloudinaryAsset(storagePath, config).catch(() => {});
}

async function readCloudinaryMedia(storagePath: string, config: StorageConfig) {
  if (!config.cloudName) throw new Error('Cloudinary cloud name is missing.');
  const [resourceType, ...publicIdParts] = storagePath.split('/');
  const response = await fetch(
    `https://res.cloudinary.com/${config.cloudName}/${resourceType}/upload/${publicIdParts.join('/')}`,
  );
  if (!response.ok) throw new Error(`Cloudinary read failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export async function saveMedia(
  buffer: Buffer,
  originalFilename: string,
  localDir: string,
  businessId?: string,
): Promise<{ storagePath: string; provider: StorageProvider }> {
  const config = await getStorageConfig(businessId);
  const safeName = `${uuid()}-${slugify(originalFilename)}`;

  if (config.provider === 'cloudinary') {
    return { storagePath: await uploadToCloudinary(buffer, originalFilename, config), provider: 'cloudinary' };
  }

  if (config.provider === 'github') {
    assertGithubConfigured();
    const [owner, repo] = GITHUB_REPO!.split('/');
    const repoPath = `media/${safeName}`;
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${repoPath}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `chore(media): add ${repoPath}`,
        content: buffer.toString('base64'),
        branch: GITHUB_BRANCH,
      }),
    });
    if (!response.ok) throw new Error(`GitHub upload failed (${response.status}): ${await response.text()}`);
    await fs.writeFile(cachePathFor(repoPath), buffer).catch(() => {});
    return { storagePath: repoPath, provider: 'github' };
  }

  await fs.mkdir(localDir, { recursive: true });
  const diskPath = path.join(localDir, safeName);
  await fs.writeFile(diskPath, buffer);
  return { storagePath: diskPath, provider: 'local' };
}

export async function readMedia(storagePath: string, provider: string, businessId?: string): Promise<Buffer> {
  if (provider === 'cloudinary') return readCloudinaryMedia(storagePath, await getStorageConfig(businessId));
  if (provider !== 'github') return fs.readFile(storagePath);

  const cached = cachePathFor(storagePath);
  try {
    return await fs.readFile(cached);
  } catch {
    // Not cached yet — fetch from GitHub.
  }

  assertGithubConfigured();
  const [owner, repo] = GITHUB_REPO!.split('/');
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${storagePath}?ref=${GITHUB_BRANCH}`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } },
  );
  if (!response.ok) throw new Error(`GitHub read failed (${response.status}): ${await response.text()}`);
  const data = (await response.json()) as { content?: string; download_url?: string };

  let buffer: Buffer;
  if (data.content) {
    buffer = Buffer.from(data.content, 'base64');
  } else if (data.download_url) {
    const fileResponse = await fetch(data.download_url);
    if (!fileResponse.ok) throw new Error(`GitHub raw download failed (${fileResponse.status})`);
    buffer = Buffer.from(await fileResponse.arrayBuffer());
  } else {
    throw new Error('GitHub returned neither inline content nor a download URL.');
  }
  await fs.writeFile(cached, buffer).catch(() => {});
  return buffer;
}

export async function materializeLocalFile(
  storagePath: string,
  provider: string,
  businessId?: string,
): Promise<{ filePath: string; cleanup: () => void }> {
  if (provider === 'local') return { filePath: storagePath, cleanup: () => {} };
  const buffer = await readMedia(storagePath, provider, businessId);
  const tmpPath = path.join(os.tmpdir(), `wa-send-${uuid()}${path.extname(storagePath)}`);
  await fs.writeFile(tmpPath, buffer);
  return { filePath: tmpPath, cleanup: () => fsSync.unlink(tmpPath, () => {}) };
}