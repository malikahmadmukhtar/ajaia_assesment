# Architecture note

## What I prioritized, and why
The brief rewards depth in a few areas. I put effort where a reviewer will actually poke: **a reliable editing/save loop, a correct sharing model, and a deployable build** — and cut breadth (realtime, comments, history).

## Shape
```
React SPA (Vite, TipTap)  ──/api/*──▶  Netlify Function (single router)  ──▶  MongoDB Atlas
        src/                           netlify/functions/api.ts                 users, documents
```
- **One repo, one deploy, same origin** → no CORS, cookies just work, a reviewer needs one URL.
- **`createHandler({repo, secret})`** (`netlify/functions/lib/handler.ts`) is a plain `Request → Response` function over a small **`Repo` interface**. Production injects `MongoRepo`; tests inject `MemoryRepo`; local dev injects a JSON-file repo. This is why the API/permission tests run in ~1s with no database.
- **Access rules in one place** (`src/shared/access.ts`), used by the server for enforcement and by the UI for affordances (read-only editor, hidden Share button). The server is the source of truth.

## Data model
- `users { _id, email (unique), name, passwordHash }`: demo accounts are created (or repaired) on first request.
- `documents { _id, title, contentHtml, ownerId, sharedWith: [{userId, role}], accessRequests: [{userId, message, createdAt}], version, createdAt, updatedAt }`.
- `attachments { _id, docId, name, size, mime, uploadedBy, createdAt, data: Binary }`: stored in Mongo (not GridFS/S3) to stay within "one free service"; the 5 MB × 10 cap keeps documents small.
- Content = sanitized **HTML**: round-trips TipTap exactly, trivial to store, and good enough for the supported formatting. (ProseMirror JSON would be better for collaboration — see "Next".)

## Key decisions & tradeoffs
| Decision | Why | Tradeoff |
|---|---|---|
| Optimistic concurrency via `version` (compare-and-set in Mongo) | Two people editing the same doc must not silently clobber each other | Conflict = "reload", no merge |
| Sanitize on **every** save + import with an allowlist (`xss`) | API accepts HTML; stored XSS would otherwise be shared to other users | Allowlist must track editor features |
| Email + password accounts, scrypt (salted, `timingSafeEqual`), signed JWT in an httpOnly SameSite=Lax cookie | Real sign-up/sign-in without a third-party service or dependency | No email verification / password reset; lockout is per instance (serverless) |
| No public user directory; share **by email** | Real sign-ups shouldn't be enumerable | Owner must know the address |
| Edit-access requests live on the document (viewer-only, idempotent, owner approves) | Smallest model that gives a real approve/deny flow; revoking a share clears the request | Dashboard learns of requests via 5 s polling, not push |
| One shared extension list (`src/shared/extensions.ts`) + a sanitizer allowlist that matches it, with a round-trip test | Editor, import and storage can't drift apart; the test fails if a node type is dropped | Adding a feature means touching both lists |
| Imports return **warnings** | Format conversion is lossy; the user is told exactly what wasn't carried over | Counts, not per-element detail |
| Export runs **client-side** from the editor's JSON/HTML (docx via `docx`, Markdown via `turndown`, both lazy-loaded) | Includes unsaved edits, no function payload/bundling limits, no extra server surface | Re-encodes images to PNG via canvas; large documents build in the browser |
| Remote Markdown images are fetched once at import (https, public IPs only, no redirects, 1 MB, 5 s) and inlined | Documents don't depend on third-party hosts | Residual DNS-rebinding window between lookup and fetch |
| Attachments: extension allowlist + magic-byte check + `Content-Disposition: attachment` + `nosniff` | A renamed binary can't masquerade, and a hostile upload can't render inline | No AV scanning |
| 404 for docs you can't access | Doesn't leak existence | Slightly less specific errors |
| Single serverless function + tiny router instead of a framework | Small surface, easy to read, fast cold start | Hand-rolled routing |
| Import converts server-side (`marked`, `mammoth`) then sanitizes | One trust boundary; docx parsing stays off the client | 2 MB cap (serverless payload limits) |
| Chose `xss` over `sanitize-html` | `sanitize-html` failed in Netlify's function bundling (ESM-only transitive dep) — found via smoke test | Different sanitizer API |

## Autosave design
Debounced (800 ms), single in-flight request, dirty flags tracked in refs so edits made *during* a save trigger another save rather than being lost; failures retry; 409 stops autosave and shows a banner; leaving the page flushes; closing the tab with unsaved work prompts.

## Testing
44 tests across `api`, `auth-access`, `rendering` and `attachments`. Highlights: `api.test.ts`: owner/editor/viewer/stranger matrix, revoke, share validation, persistence + version bump, sanitization (script/onerror stripped, formatting kept), stale-version 409, input validation, and imports (md formatting, txt escaping, real generated `.docx`, unsupported/empty/oversized/corrupt files). Also smoke-tested through the actual `netlify dev` runtime with curl.

Auth/access tests cover signup/login validation, duplicate emails, uniform login errors, lockout, the full request→approve/deny flow and its permission edges. Rendering tests build a real `.docx` (heading levels, inline formatting, nested lists, quote, table with merged cell, hyperlink, footnote, embedded PNG) and a full-GFM Markdown file, then push both through the sanitizer **and the real TipTap schema** and assert no node type is lost; hostile-HTML cases (`javascript:` links, `onerror`, SVG/`data:text/html` images, hostile styles) are neutralized. Export tests unzip the generated `.docx` and assert headings, formatting, list numbering, table (merged cells), hyperlink, image and alignment; the Markdown export is re-imported through our own importer to prove it round-trips. Attachment tests cover the permission matrix, type/signature/size/count limits, filename cleaning, download headers and cascade delete.

**Not covered:** the Mongo repository has no automated test (it mirrors `MemoryRepo`'s contract but is only exercised against a real Atlas cluster at deploy time); there are no browser/E2E tests for the React UI.

## Deliberately not built
Real-time co-editing/presence, comments, version history, OAuth/email verification/password reset, link sharing, PDF import, export, rename from the dashboard, pagination/search, `.docx` text colors/fonts/alignment/page layout/tracked changes/charts, Markdown task lists as real checkboxes (rendered as ☑/☐ text).

## Next, with another 2–4 hours
1. Real-time collaboration (Yjs + a websocket/provider) replacing the 409 flow.
2. Version history (store snapshots on save) and restore.
3. Mongo integration test + Playwright smoke test of the share flow.
4. Email verification + password reset, link sharing, push updates for the dashboard.
