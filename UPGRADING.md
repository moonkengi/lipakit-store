# Upgrading

New versions arrive as a new download (or on the delivery repository if you have access). Your copy is your code, so upgrading is a merge, not a reinstall.

## The safe way

1. Commit your work. Create a branch: `git checkout -b upgrade-x.y`.
2. Read `CHANGELOG.md` for every version between yours and the new one. Look for **Database** and **Breaking** notes.
3. Copy the new kit over your branch, or, if you kept the original as a remote (`git remote add lipakit <delivery repo>`), run `git merge lipakit/main`.
4. Resolve conflicts. Your changes most often touch `src/config/*`, `src/app/(marketing)/*`, `src/lib/notify/messages.ts` and `globals.css`; keep yours.
5. `pnpm install`, then `pnpm typecheck && pnpm lint && pnpm test`.
6. Apply new database migrations (below), deploy to a preview, run `pnpm run doctor --url <preview>`, then promote.

## Database migrations

Migrations are numbered files in `supabase/migrations/` and never edited after release; new versions only **add** files.

- **Supabase CLI:** `supabase db push` applies the ones you don't have.
- **SQL editor:** run each new migration file, in order, that you haven't run before. Don't re-run `supabase/setup.sql` on an existing database: it's for fresh projects only.

## Keeping customisations easy to merge

- Put your own features in new files and folders rather than editing kit files.
- Change behaviour through `src/config/*` and the plans table where you can.
- If you must change a kit file, keep the change small and add a comment, so it stands out in a merge.

## Your update window

Your licence covers updates released until the date in `LICENSE.md` (also on the admin Health page). Versions released after it need an update renewal; everything you already have keeps working forever.
