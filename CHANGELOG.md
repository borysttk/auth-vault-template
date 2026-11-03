# Changelog — mcp-auth-vault

# Changelog — mcp-auth-vault

## [0.2.2] — 2026-10-08

### Added
- Added ability to edit credentials and secrets via the Web UI (port 5600).
- Added modals and JavaScript functions for editing credential and secret entries.
- Updated action buttons in credential and secret lists to include an edit button (✎).

### Changed
- Switched from npm to pnpm for dependency management (updated lockfile, added esbuild as devDependency, adjusted install scripts).
- Updated systemd service to point to `/home/ttk/.hermes/q-auth-vault/dist/index.js` (removed reference to hermes-vault-data).
- Removed the `hermes-vault-data/dist` directory to avoid duplication.
- Fixed TypeScript compilation errors:
  - Expanded `SSHKeyEntry` interface in `src/ssh/types.ts` with optional decrypted fields (`privateKey?`, `passphrase?`, `comment?`).
  - Corrected assignment of `label`, `kind`, `service` in secret update handler (`src/web/server.ts`) to update entry‑level metadata (`entryUpdates`) instead of encrypted fields.
  - Removed erroneous `fields.label` assignment in credential update handler.
- General code cleanup and alignment with the vault’s encrypted‑payload structure.

### Fixed
- Build failures due to missing `@types/node` and incorrect interface definitions.
- Property‑does‑not‑exist errors on `SSHKeyEntry` (`privateKey`, `passphrase`, `comment`) and on credential/secret update objects (`label`, `kind`, `service`).
- Heap‑out‑of‑memory during `tsc` in `hermes-vault-data` (now unused).

### Security
- No changes to encryption or secret handling; all secrets continue to be managed exclusively via the auth‑vault REST API (port 5600) or MCP tools, never exposed in CLI or logs.

---

## [0.2.1] — 2026-10-08

### Changed
- Switched from npm to pnpm for dependency management (updated lockfile, added esbuild as devDependency, adjusted install scripts).
- Updated systemd service to point to `/home/ttk/.hermes/q-auth-vault/dist/index.js` (removed reference to hermes-vault-data).
- Removed the `hermes-vault-data/dist` directory to avoid duplication.
- Fixed TypeScript compilation errors:
  - Expanded `SSHKeyEntry` interface in `src/ssh/types.ts` with optional decrypted fields (`privateKey?`, `passphrase?`, `comment?`).
  - Corrected assignment of `label`, `kind`, `service` in secret update handler (`src/web/server.ts`) to update entry‑level metadata (`entryUpdates`) instead of encrypted fields.
  - Removed erroneous `fields.label` assignment in credential update handler.
- General code cleanup and alignment with the vault’s encrypted‑payload structure.

### Fixed
- Build failures due to missing `@types/node` and incorrect interface definitions.
- Property‑does‑not‑exist errors on `SSHKeyEntry` (`privateKey`, `passphrase`, `comment`) and on credential/secret update objects (`label`, `kind`, `service`).
- Heap‑out‑of‑memory during `tsc` in `hermes-vault-data` (now unused).

### Security
- No changes to encryption or secret handling; all secrets continue to be managed exclusively via the auth‑vault REST API (port 5600) or MCP tools, never exposed in CLI or logs.

## [0.2.0] — 2026-06-30