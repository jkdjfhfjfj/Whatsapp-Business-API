# WhatsApp Business Support Workspace

This app gives a support team a mobile-friendly WhatsApp inbox with webhook-connected messaging,
media handling, AI replies, and WABA settings. It is a single-workspace app with no browser login.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/whatsapp-platform run dev` — run the support workspace
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run render:build` — build the frontend into the API server for a single Render service
- `pnpm run render:start` — start the Render-compatible single service
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/api-server run db:push` — push the imported WhatsApp schema to the current `DATABASE_URL`
- Required env: `DATABASE_URL` — PostgreSQL connection string
- Required env: `SESSION_SECRET` — stable encryption seed for stored Meta/Groq credentials; it is not a login secret anymore
- Webhook env: `WHATSAPP_VERIFY_TOKEN` — the exact token entered in Meta's callback settings

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/whatsapp-platform/src/` — React/Vite support workspace
- `artifacts/api-server/src/` — Express API, WhatsApp webhook, media, bot, and database services
- `render.yaml` — one-service Render build/start configuration
- `lib/db/src/schema/` — shared workspace schema; the imported WhatsApp schema lives with the API server because it is also deployable independently

## Architecture decisions

- The Render deployment is one Node service: the frontend is built first and copied into the API server's `public` folder.
- Meta webhook verification accepts `WHATSAPP_VERIFY_TOKEN` before checking the database so verification is not blocked by tenant initialization or migrations.
- The API service keeps `/webhook` and `/ws` outside `/api`; both paths are explicitly routed in the artifact proxy.

## Product

- Mobile-first inbox for WhatsApp conversations
- Text, document, image, video, and audio handling
- AI reply settings and human takeover
- WABA connection and webhook settings
- Tags, notes, quick replies, agents, and dashboard metrics

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Meta callback URL must be `https://<published-render-host>/webhook` with no spaces.
- Set `WHATSAPP_VERIFY_TOKEN` to the same value entered in Meta; `access123` is valid only if both sides use it.
- The permanent/system-user Meta access token is saved in Settings → WhatsApp. Never paste it into source code.
- A Meta OAuth error 190 or HTTP 401 means the token is expired, revoked, malformed, or not authorized for the WABA/phone number. Replace it in Settings → WhatsApp, save, and run Test connection.
- Keep `SESSION_SECRET` unchanged after saving credentials. Changing it without also re-saving all credentials makes old encrypted values unreadable.
- After changing the database schema, run `pnpm --filter @workspace/api-server run db:push` against the same `DATABASE_URL` used by Render.

## Render setup

1. Create a Render Blueprint from this repository so `render.yaml` creates the web service and its
   persistent media disk.
2. Set `DATABASE_URL`, a long random `SESSION_SECRET`, and `WHATSAPP_VERIFY_TOKEN` in the Render
   service environment. Keep `MEDIA_STORAGE_DIR=/var/data/media`.
3. Deploy and wait for `GET /health` to report a connected database.
4. Open the published app's Settings → WhatsApp and save the Meta App ID, permanent access token,
   WABA ID, phone number ID, and API version. `v20.0` is the default.
5. In Meta App Dashboard, set the callback URL to the published URL plus `/webhook`, enter the same
   verify token, verify it, and subscribe the app to the `messages` webhook field.
6. Use Test connection before sending. For inbound media, the token must be valid for the same
   WABA and phone number and include WhatsApp Business messaging permissions.

The Render service serves the built frontend and API from one process. The required public paths are
`/api`, `/webhook`, `/ws`, and `/health`. The persistent disk prevents uploaded and downloaded media
from disappearing on deploys or restarts.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
