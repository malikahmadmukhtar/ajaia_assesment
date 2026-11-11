# Ajaia Docs: lightweight collaborative document editor

A small Google-Docs-inspired app: sign up, create and rename rich-text documents, import `.txt` / `.md` / `.docx` files (new document **or into an existing draft**), attach files to a document, share with other users (editor or view-only), and request edit access as a viewer.

**Live app:** `<ADD NETLIFY URL>`  ·  **Walkthrough video:** see `VIDEO_URL.txt`

## Try it in 60 seconds (reviewers)
Sign up with any email, or use a demo account (password **`demo1234`**; one-click buttons on the login page):

| User | Email |
|---|---|
| Alice Johnson | alice@example.com |
| Bob Martinez | bob@example.com |
| Carol Singh | carol@example.com |

1. Sign in as **Alice** → **New document** → type, format, rename the title, refresh: it persists.
2. **Import file** on the dashboard (`.md` / `.docx` with tables, images, links) → opens as a new document. Inside the editor, **⬆ Import** inserts a file into the open draft.
3. Scroll to **Attachments** → attach a PDF/image/etc. (drag-and-drop works). Anyone with access can download it.
4. **Share** → add `bob@example.com` as **View only**.
5. **Log out**, sign in as **Bob** (or use a second browser): the doc is under **Shared with me**, read-only. Click **Request edit access**.
6. Back as Alice: the dashboard shows an "edit request" badge → **Share** → **Approve**. Bob's open editor unlocks within a few seconds.

## Features
- **Rich text (TipTap):** bold, italic, underline, strike, sub/superscript, H1–H3, bulleted/numbered/nested lists, quotes, code blocks, rules, alignment, links, images (insert or import), tables with row/column controls. Stored as sanitized HTML.
- **Import fidelity:** `.docx` keeps headings, inline formatting, lists, tables (incl. merged cells), hyperlinks, footnotes and **embedded images**; `.md` supports full GFM (tables, task lists as ☑/☐ text, code, strikethrough, front matter) and inlines `data:` and remote **https** images. Anything that can't be carried over is reported in an **Import note**, never silently dropped.
- **Export** (⬇ Export in the editor, available to anyone with access): **Word (.docx)** with headings, formatting, lists, tables (merged cells), links and images; **Markdown (.md)** with GFM tables/code; **plain text (.txt)**. Exports the live editor content, including unsaved edits.
- **Autosave** with a visible status, conflict detection (409) instead of silent overwrites, flush on leave.
- **Sharing:** owner / editor / viewer, owned vs. shared sections, share by email, revoke. Collaborator names/emails are visible to the owner only.
- **Edit-access requests:** viewers ask; the owner approves/denies from the Share dialog.
- **Attachments:** up to 10 per document, 5 MB each, validated by extension **and** file signature; always downloaded, never rendered inline.
- **Accounts:** email + password (scrypt), httpOnly session cookie, best-effort lockout after 5 failures.
- **Validation:** every endpoint validates input (zod) and returns per-field errors; forms validate inline; uploads are checked client- and server-side.

### Supported files
| Where | Types | Limit |
|---|---|---|
| Import (new doc / into draft) | `.txt` `.md` `.docx` | 2 MB (images ≤ 1 MB each, ≤ 15) |
| Attachments | `.txt .md .docx .pdf .png .jpg .jpeg .gif .csv .xlsx .pptx` | 5 MB, 10 per doc |
| Inserted images | PNG, JPEG, GIF, WebP | 1 MB |

## Run locally
Requires Node 20+.
```bash
npm install
npm run dev        # netlify dev → http://localhost:8888
```
With no `MONGODB_URI`, local dev uses a JSON file store at `.data/dev-store.json`: nothing else to set up. **If you have a `.env` with a real `MONGODB_URI`, `netlify dev` will use that database**; to force the file store anyway run `LOCAL_STORE=1 npm run dev`. To use MongoDB, copy `.env.example` to `.env` and set `MONGODB_URI` (with a database name) and `SESSION_SECRET`.

```bash
npm test           # Vitest: 44 tests
npm run typecheck
npm run build
```

## Deploy (Netlify + MongoDB Atlas, both free tier)
1. Create a free **MongoDB Atlas** M0 cluster + database user. Under *Network Access* allow `0.0.0.0/0` (Netlify functions have no fixed IPs).
2. Push to Git and import in Netlify (`netlify.toml` has the build settings), or `npx netlify deploy --build --prod`.
3. Set env vars in Netlify: `MONGODB_URI` (include a database name, e.g. `.../ajaia_docs?...`) and `SESSION_SECRET` (long random string).
4. Demo accounts are created/repaired automatically on the first API request. **They have a publicly documented password, so remove them (or don't seed) for any real deployment.**

## Known limits
No real-time co-editing (a stale save gets a 409, not a merge), no email verification or password reset, lockout is per server instance, no virus scanning on attachments, `.docx` text colors/fonts/alignment/page layout/comments/tracked changes/charts are not carried over on import. Exports: Markdown has no syntax for alignment (kept as `<div align>`), underline/sub/superscript (kept as inline HTML) or code-block language; plain text drops all formatting; images become `[image]` in `.txt`. See `ARCHITECTURE.md`.
