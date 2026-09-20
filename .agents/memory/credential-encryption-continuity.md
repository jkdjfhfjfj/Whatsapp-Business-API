---
name: Credential encryption continuity
description: How the single-workspace app preserves encrypted Meta and AI credentials after browser authentication changes.
---

The stable credential-encryption secret must be preserved when changing or removing browser authentication. Existing Meta and AI settings are encrypted at rest, so rotating or renaming the fallback secret without re-saving every credential makes stored values undecryptable.

**Why:** The app no longer needs browser sessions, but the same deployment still needs to decrypt previously saved WABA and AI credentials.

**How to apply:** Keep the existing `SESSION_SECRET` value stable, or explicitly migrate all encrypted settings before switching to `CREDENTIALS_ENCRYPTION_KEY`.