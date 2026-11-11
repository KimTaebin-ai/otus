# shared/

Code used by both the student app (`frontend/`) and the admin app (`admin-front/`). Each app reaches it through a symlink, `src/shared -> ../../shared`, and imports it as `@otus/shared/*`. The rules are in the root `CLAUDE.md`; the symlink setup, Windows included, is in the root `README.md`.
