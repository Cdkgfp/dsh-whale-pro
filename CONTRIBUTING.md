# Contributing

Thanks for taking a look at `dsh-whale-compact`.

## Before opening an issue

- Confirm the DSH version, whether you use the Desktop (Electron) client or `dsh web`, and whether this plugin is installed in the correct profile.
- Include reproduction steps and the expected/actual result.
- Remove API keys, tokens, cookies, credentials, personal paths and unredacted logs. Do not paste a complete DSH profile or credential file.

Security-sensitive reports should use GitHub private vulnerability reporting/security advisories rather than a public issue.

## Pull requests

- Keep changes focused; describe which UI path and which files are affected.
- Frontend changes live in `assets/whale-widget.js`; host/routes/accounting changes live in `lib/`.
- Run syntax checks before opening a PR:

  ```powershell
  node --check lib/index.js
  node --check assets/whale-widget.js
  ```

- If you change the UI, include a small screenshot or GIF in the PR when possible.
- Do not commit runtime data (`$DSH_HOME` files), local backups, `node_modules`, or credentials.
- The code is MIT-licensed. Artwork and audio in `assets/` are provided as-is under the terms in [PROVENANCE.md](PROVENANCE.md); do not relicense them without confirming the rights.
