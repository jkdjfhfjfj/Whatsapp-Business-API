# WhatsApp Business API

This app gives a support team a mobile-friendly WhatsApp inbox with webhook-connected messaging, media handling, AI replies, and WABA settings.

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/whatsapp-platform run dev` — run the Android-style support workspace
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run render:build` — build the frontend into the API server for a single Render service
- `pnpm run render:start` — start the Render-compatible single service
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/api-server run db:push` — push the imported WhatsApp schema to the current `DATABASE_URL`
- Required env: `DATABASE_URL` — Neon/Postgres connection string
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

- Meta callback URL must be `https://<render-host>/webhook` with no spaces.
- Set `WHATSAPP_VERIFY_TOKEN` to the same value entered in Meta; `access123` is valid only if both sides use it.
- After changing the Neon schema, run the server's Drizzle push command against the same `DATABASE_URL` used by Render.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
