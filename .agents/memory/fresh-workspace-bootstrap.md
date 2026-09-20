---
name: Fresh workspace bootstrap
description: Startup prerequisites for a reset workspace with the WhatsApp API and settings UI.
---

After a project reset, the API may fail before serving routes if workspace dependencies have not been installed or the development PostgreSQL database has not received the current schema. Treat a missing dependency build error and a missing-table startup error as bootstrap blockers before investigating endpoint logic.

**Why:** The connection-settings error was only a symptom; the API could not start until dependencies were restored and the existing schema was applied.

**How to apply:** When the API workflow fails on a fresh/reset workspace, install the locked workspace dependencies, apply the documented development schema, restart the API, then verify the settings endpoint through the shared proxy.