import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuid } from 'uuid';

// Two providers:
//  - 'local'  (default): files live on disk at MEDIA_STORAGE_DIR. Durable only if that path is
//              a mounted Persistent Disk in production — see README.
//  - 'github': files are committed to a GitHub repo via the Contents API. This trades away
//              rate limits (5,000 req/hr), file-size headroom (~100MB/file via this API), and
//              real deletion (git history keeps every blob) for "no separate storage service to
//              pay for." A local read cache (below) keeps repeat views from re-hitting GitHub.
//              See README "Media storage" section before using this in production.
const PROVIDER: 'local' | 'github' = process.env.STORAGE_PROVIDER === 'github' ? 'github' : 'local';
export const activeStorageProvider = PROVIDER;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_MEDIA_REPO; // "owner/repo"
const GITHUB_BRANCH = process.env.GITHUB_MEDIA_BRANCH || 'main';
const GITHUB_API = 'https://api.github.com';

function assertGithubConfigured() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    throw new Error(
      'STORAGE_PROVIDER=github requires GITHUB_TOKEN (a fine-grained PAT with Contents: read/write ' +
      'on the target repo) and GITHUB_MEDIA_REPO ("owner/repo") to be set.',
    );
  }
}

function slugify(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '-');
}

// Local disk-backed read cache for GitHub-stored files, so viewing the same photo twice doesn't
// cost two GitHub API calls. Irrelevant (and unused) when PROVIDER === 'local'.
const CACHE_DIR = path.join(os.tmpdir(), 'wa-platform-media-cache');
fsSync.mkdirSync(CACHE_DIR, { recursive: true });
function cachePathFor(storagePath: string) {
  return path.join(CACHE_DIR, Buffer.from(storagePath).toString('base64url'));
}

export async function saveMedia(
  buffer: Buffer,
  originalFilename: string,
  localDir: string,
): Promise<{ storagePath: string; provider: 'local' | 'github' }> {
  const safeName = `${uuid()}-${slugify(originalFilename)}`;

  if (PROVIDER === 'github') {
    assertGithubConfigured();
    const [owner, repo] = GITHUB_REPO!.split('/');
    const repoPath = `media/${safeName}`;

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${repoPath}`, {
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
    if (!res.ok) {
      throw new Error(`GitHub upload failed (${res.status}): ${await res.text()}`);
    }
    // Warm the cache immediately so the first view doesn't need a round-trip.
    await fs.writeFile(cachePathFor(repoPath), buffer).catch(() => {});
    return { storagePath: repoPath, provider: 'github' };
  }

  await fs.mkdir(localDir, { recursive: true });
  const diskPath = path.join(localDir, safeName);
  await fs.writeFile(diskPath, buffer);
  return { storagePath: diskPath, provider: 'local' };
}

export async function readMedia(storagePath: string, provider: string): Promise<Buffer> {
  if (provider !== 'github') {
    return fs.readFile(storagePath);
  }

  const cached = cachePathFor(storagePath);
  try {
    return await fs.readFile(cached);
  } catch {
    // not cached yet — fall through to fetch from GitHub
  }

  assertGithubConfigured();
  const [owner, repo] = GITHUB_REPO!.split('/');
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${storagePath}?ref=${GITHUB_BRANCH}`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as {
    content?: string;
    download_url?: string;
  };

  let buffer: Buffer;
  if (data.content) {
    buffer = Buffer.from(data.content, 'base64');
  } else if (data.download_url) {
    // Files over ~1MB come back without inline content — GitHub gives a short-lived signed URL
    // for the raw blob instead.
    const fileRes = await fetch(data.download_url);
    if (!fileRes.ok) throw new Error(`GitHub raw download failed (${fileRes.status})`);
    buffer = Buffer.from(await fileRes.arrayBuffer());
  } else {
    throw new Error('GitHub returned neither inline content nor a download_url for this file.');
  }

  await fs.writeFile(cached, buffer).catch(() => {});
  return buffer;
}

// Some outbound sends (the whatsappcloudapi_wrapper's file_path option) need a real path on the
// local filesystem. For 'local' storage that's just storagePath. For 'github' storage, this
// downloads (or reuses the cache) into a throwaway temp file — always call cleanup() after use.
export async function materializeLocalFile(
  storagePath: string,
  provider: string,
): Promise<{ filePath: string; cleanup: () => void }> {
  if (provider !== 'github') {
    return { filePath: storagePath, cleanup: () => {} };
  }
  const buffer = await readMedia(storagePath, provider);
  const tmpPath = path.join(os.tmpdir(), `wa-send-${uuid()}${path.extname(storagePath)}`);
  await fs.writeFile(tmpPath, buffer);
  return { filePath: tmpPath, cleanup: () => fsSync.unlink(tmpPath, () => {}) };
}
