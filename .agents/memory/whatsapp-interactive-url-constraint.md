---
name: WhatsApp interactive URL constraint
description: The Meta Cloud API distinguishes reply buttons from URL call-to-action messages.
---

Reply buttons cannot carry links. A reply-button interactive message uses one or more `{id, title}` buttons; a URL action is a separate `cta_url` interactive message with exactly one button.

**Why:** Treating a URL as a reply-button ID makes the message appear configurable in the UI but produces an invalid or misleading Meta payload.

**How to apply:** Offer reply ID and URL as mutually exclusive button choices, and route URL-button sends through `interactive.type = cta_url` with one button.