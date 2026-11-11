# Submission contents

## Links
| | URL |
|---|---|
| **Live app** | `<ADD LIVE URL>` |
| **Walkthrough video** | `<ADD VIDEO URL>` (also in `VIDEO_URL.txt`) |
| **Google Drive folder** | `<ADD DRIVE FOLDER URL>` |

## Test accounts
Sign up with any email, or use a demo account (one-click buttons on the login page, password `demo1234`):

- alice@example.com
- bob@example.com
- carol@example.com

**To test sharing:**
1. Sign in as Alice and share a document with `bob@example.com` as **View only**.
2. In a second browser, sign in as Bob. The document appears under **Shared with me**.
3. As Bob, click **Request edit access**.
4. As Alice, open **Share** and approve the request.

## What's in this folder
| Item | Location |
|---|---|
| Source code | `src/` (React app), `netlify/functions/` (API), `tests/` (44 Vitest tests) |
| Setup and run instructions | `README.md` |
| Architecture note | `ARCHITECTURE.md` |
| AI workflow note | `AI_WORKFLOW.md` |
| This file | `SUBMISSION.md` |
| Walkthrough video URL | `VIDEO_URL.txt` |
| Config | `package.json`, `package-lock.json`, `netlify.toml`, `redirects/_redirects`, `vite.config.ts`, `tsconfig.json`, `.env.example` |

Not included on purpose: `.env` (credentials), `node_modules/`, `dist/`, `.netlify/`, `.data/`. Running `npm install` restores the dependencies.

## Status
**Working end to end:**
- Sign up, sign in and log out.
- Create, rename, edit, autosave and reopen documents.
- Rich text: headings, bold, italic, underline, strike, lists, tables, images, links, quotes, code and alignment.
- `.txt`, `.md` and `.docx` import, either as a new document or into an existing draft, keeping images, tables and links, with fidelity warnings.
- Per-document attachments.
- Owner, editor and viewer sharing by email, with owned and shared views and revoke.
- Viewers can request edit access, and the owner approves or denies.
- Export to `.docx`, `.md` and `.txt`.
- MongoDB persistence.
- Server- and client-side validation.

**Not built:**
- Real-time co-editing (edits are protected by conflict detection instead).
- Version history and comments.
- Email verification and password reset.
- `.docx` colors, fonts and alignment on import.
- Automated browser/E2E tests and Mongo integration tests. These were verified manually on the live deployment.

**Next, with 2–4 more hours:**
1. Real-time collaboration (Yjs) in place of the conflict prompt.
2. Version history with restore.
3. Playwright E2E for the sharing and request flow, plus a Mongo integration test.
4. Password reset and email verification.
