# AI-native workflow note

## Tools
- **Claude Code** (VS Code extension) as a pair programmer for planning, scaffolding, writing code and tests, and running builds, tests and smoke tests.
- The product itself has no AI features. I spent the time on the editor, file handling, sharing and the deploy path.

## Where AI materially sped things up
- **Scoping:** it turned the open-ended brief into a plan, then checked that plan against every requirement. That surfaced issues early: lost updates when two people edit, sanitizing on *every* save and not only on import, idempotent seeding on serverless, and testing without a database.
- **Boilerplate-heavy work:** Vite, TipTap and Netlify scaffolding, zod schemas, the Mongo repository, and the permission-matrix tests.
- **Test fixtures that would have been slow by hand:** a `.docx` generated in code (heading levels, nested lists, a table with merged cells, a hyperlink, a footnote, an embedded image) and a full-GFM Markdown file. Both are pushed through the real editor schema to prove nothing is dropped.

## What I changed or rejected
- **Replaced `sanitize-html` with `xss`.** It passed every unit test but crashed inside Netlify's function bundling because of an ESM-only dependency. Only running the real runtime revealed it.
- **Replaced the in-memory dev store with a JSON-file store.** Netlify's local runtime doesn't keep memory between requests, so sharing "worked" in tests but failed locally.
- **Fixed a real bug in AI-written code that a test caught:** re-sending an edit-access request silently erased the original message.
- **Fixed two export bugs that tests caught before any browser did:** Markdown strikethrough came out with a single tilde, and Markdown tables came out as raw HTML.
- **Fixed a smoke-test mistake:** `netlify dev` silently loaded my real `.env` and wrote test accounts into Atlas. I cleaned the database and added an explicit `LOCAL_STORE=1` switch. Lesson: don't smoke-test with production credentials in scope.
- **Narrowed requests:** the first design for "request access" let strangers request access via a link, which leaks document titles. I narrowed it to viewers asking for edit access, and strangers still get a 404.
- **Removed the public user list** once real sign-ups existed, because it would leak email addresses. Sharing is by email instead.
- **Made deliberate cuts:**
  - Markdown task lists become ☑/☐ text.
  - `.docx` colors, fonts and alignment aren't imported.
  - There is no real-time co-editing; a stale save gets a clear 409 and is never silently overwritten.

## How I verified
- **Automated:** 44 Vitest tests covering:
  - sharing and permissions (owner, editor, viewer, stranger)
  - sign-up, login and lockout
  - the edit-request flow
  - sanitization of hostile HTML
  - conflict detection
  - input validation
  - `.docx` and Markdown import fidelity through the real editor schema
  - attachment limits and download headers
  - export to `.docx`, `.md` and `.txt` (the Markdown output is re-imported as a round-trip check)

  Also: strict TypeScript typecheck and a production Netlify build.
- **Runtime:** curl smoke tests against `netlify dev` and against the bundled production function. This is what caught the bundling and proxy bugs that unit tests couldn't.
- **Live deployment:** smoke-tested the deployed app against MongoDB Atlas, which exercises the Mongo code paths that have no automated tests.
- **UX:** clicked through the main flows on the deployed app with two browser profiles: sign-up and login, create, edit and autosave, import, sharing and the owned/shared views, edit-access requests, attachments and export.
- **Known gaps:** there are no browser/E2E tests and no automated tests for the Mongo repository. Both were verified manually on the live deployment only.
