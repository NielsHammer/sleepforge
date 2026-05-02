# SleepForge Project Context for Future Claude Sessions

This folder contains the persistent memory built up across sessions on the
Hetzner server. When SleepForge runs on a new machine (e.g. Niels' Mac), a
fresh Claude Code session will not have access to those memories. So the
files are copied here in version control to give any future session the
same project understanding.

## How to use

If you're a new Claude Code session:

1. Read `MEMORY.md` first — it's the index of all the other files in this
   folder. Keep it short.
2. Read each file linked from `MEMORY.md`. The frontmatter (`name`,
   `description`, `type`) tells you what kind of memory it is and when it
   applies.
3. Re-create these as actual `~/.claude/projects/.../memory/` files on
   your machine if you want them auto-loaded as system memory across all
   sessions, or just keep them as in-repo references.

## File types

- `user_*.md` — who Niels is, his role, communication preferences
- `project_*.md` — the broader Videvo / SleepForge project context
- `feedback_*.md` — guidance Niels has given that should shape future work
   (corrections, validated approaches, communication style, etc.)
- `reference_*.md` — pointers to external systems (none yet)

## Updating

If you learn something new about Niels, the project, or get feedback that
should persist:

1. Update the matching `feedback_*.md` / `project_*.md` file (or create a
   new one).
2. Add or update the line in `MEMORY.md` that links to it.
3. Commit the changes so the next session — anywhere — has them.
