<!--
Purpose: Records user-visible changes to Remote Toolkit releases.
@author    Pinaki Das <pinaki.das@sage.com>
@copyright 2026 Sage Intacct Corporation, All Rights Reserved
-->

# Changelog

All notable changes to Remote Toolkit are documented here.

## [0.5.12] — 2026-09-30

### Changed
- Updated the Marketplace icon from the supplied Remote Toolkit artwork and replaced the Activity Bar icon with its compact terminal/server-transfer counterpart.
- Reduced the packaged VSIX from approximately 16.4 MB / 803 files to 3.65 MB / 349 files by excluding non-runtime `node-pty` build inputs and Windows debug symbols, while retaining all reconnect runtime binaries.

### Documentation
- Added the remote `~/bin/phpunit` wrapper creation and verification instructions for Intacct-style PHPUnit runs.

## [0.5.11] — 2026-09-30

### Changed
- Replaced the Activity Bar's legacy `SSH` artwork with a compact `RT` Remote Toolkit icon.

## [0.5.10] — 2026-09-30

### Added
- Explorer-file action **Run PHPUnit: This File**, using the selected SFTP PHPUnit target and the existing saved-credential flow.

## [0.5.9] — 2026-09-30

### Added
- Explorer-folder action **Run PHPUnit Tests in Folder**, which runs PHPUnit discovery for the selected workspace-relative directory.

## [0.5.8] — 2026-09-30

### Fixed
- Password-authenticated PHPUnit runs now allow the extension's forced private `SSH_ASKPASS` helper to provide the saved credential, rather than combining it with `BatchMode=yes`, which disables password interaction.

## [0.5.7] — 2026-09-30

### Changed
- Reconnect configuration uses the concise boolean `"reconnect": true` form exclusively.

## [0.5.5] — 2026-09-30

### Fixed
- When Windows OpenSSH is unavailable, reconnect-enabled hosts now gracefully fall back to the standard SSH terminal rather than displaying a failed reconnect prompt.

## [0.5.4] — 2026-09-30

### Fixed
- Reconnect-enabled terminals on Windows now launch the installed Windows OpenSSH client by its absolute system path instead of relying on `node-pty`'s unreliable `PATH` lookup.

## [0.5.3] — 2026-09-30

### Changed
- PHPUnit CodeLens and Command Palette runs now select the currently active SFTP target when that host is PHPUnit-enabled. The legacy `phpunitDefault` field remains only as a compatibility fallback.
- Renamed the SFTP status-bar indicator from `RT-SFTP- <hostname>` to `RT-<hostname>`.
- Retained the `ssh-ui.setPhpunitDefaultHost` command ID for compatibility; it now opens the SFTP target picker.

## [0.5.2] — 2026-09-30

### Changed
- Replaced the mandatory `sftp.hostFingerprint` configuration with SSH-style trust on first use. Remote Toolkit displays the key before first authentication, stores an explicitly accepted key in VS Code SecretStorage, and requires confirmation before replacing a changed key.
- Retained `sftp.hostFingerprint` as an optional strict override for centrally managed hosts.

## [0.5.1] — 2026-09-29

### Security
- SFTP now requires a configured `sftp.hostFingerprint` and verifies the server's SHA-256 host-key fingerprint before authentication or file transfer. This prevents `ssh2-sftp-client`'s insecure default auto-accept behavior.
- Password-auth SSH sessions now create a unique, private `SSH_ASKPASS` helper per connection and remove it when the terminal or PHPUnit process finishes.

### Fixed
- Upload Active File and upload-on-save now create missing remote parent directories before transfer.
- PHPUnit output runs now use a saved secret as an encrypted SSH key passphrase when an `identityFile` is configured.
- Restored the ESLint 9 flat configuration and added the missing lint dependency declaration.
- Made `npm test` run the maintained unit-test suite; extension-host and real-remote checks remain manual integration work.

## [0.5.0] — 2026-09-22

### Added
- SFTP folder sync via **Remote Toolkit: Sync Folder via SFTP**, with per-host `sftp.syncMode`:
  - `"update"` (default) — only uploads files newer than the remote copy
  - `"mirror"` — also deletes remote files no longer present locally (confirmation required)
- Per-host `sftp.ignore` list — plain name matching (not globs) to exclude paths like `node_modules`, `.git`, `.vscode` from both upload and mirror-delete.
- **Remote Toolkit: Select SFTP Target** command, persisted across sessions, with a status bar indicator (`RT-SFTP- <hostname>`) for quick switching.
- SFTP target indicator now appears on the left side of the status bar.
- Upload-on-save: saving a file inside the active SFTP target's workspace uploads it automatically on explicit `Ctrl+S`. Autosave-triggered uploads are opt-in via `sftp.uploadOnAutoSave`.
- Upload and folder-sync progress indicators, plus timestamped upload success/failure history in the `Remote Toolkit — SFTP` output channel.
- `sftp.enabled` is no longer required — presence of an `sftp.remotePath` is now sufficient to treat a host as SFTP-configured.

### Fixed
- Reconnect-enabled SSH terminals now wait briefly for valid VS Code terminal dimensions before spawning the PTY, preventing long command lines from wrapping at the 80-column fallback width.

## [0.4.1] — 2026-09-22

### Fixed
- Reconnect-enabled SSH terminals now send keepalive probes (`ServerAliveInterval`/`ServerAliveCountMax`) so a dropped network connection is detected within ~10 seconds and triggers the reconnect prompt, instead of the terminal appearing frozen indefinitely.
- Added `ConnectTimeout` so a reconnect attempt against an unreachable host fails fast and re-offers the reconnect prompt, rather than hanging.
- Fixed `node-pty`'s bundled `spawn-helper` binary losing its executable permission during install/packaging, which caused `posix_spawnp failed` errors when starting reconnect-enabled sessions.
- Reused a single SFTP output channel (registered for proper disposal) instead of creating a new, undisposed channel on every directory listing.
- Replaced the extension icon, which previously had `$ ssh` text baked into the image.

## [0.4.0] — 2026-09-21

### Added
- Opt-in auto-reconnect for SSH terminals via `"reconnect": true` per host.
- When enabled, a broken SSH connection stays in the terminal and offers "press any key to reconnect" (PuTTY-style), instead of the terminal closing.
- Graceful fallback to the standard terminal (with a warning) if the native `node-pty` module fails to load on a given platform.

### Unchanged
- Hosts without `reconnect.enabled` continue to use the existing terminal-based SSH connection exactly as before.

## [0.3.0] — 2026-09-20

### Added
- SFTP support for enabled hosts using saved passwords or configured identity files.
- Upload the active workspace file via SFTP.
- Download a remote file via SFTP.
- List a remote SFTP directory in the `Remote Toolkit — SFTP` output channel.
- Optional per-host `sftp.enabled` and `sftp.remotePath` configuration.

### Changed
- Remote Toolkit now provides SSH, SFTP, and remote PHPUnit workflows from one extension.

## [0.2.1] — 2026-07-27

### Fixed
- Shell-safe PHPUnit remote command construction for remote paths, file paths, and filter arguments.
- Shell-safe terminal fallback command construction.
- Restored connect, save-password, remove-host, and edit-config behavior on PHPUnit-enabled hosts.
- Guarded file-based PHPUnit runs so they only execute for files inside the current workspace.

### Added
- **Set Default PHPUnit Host** command for selecting the host used automatically by CodeLens and palette runs.
- Status bar selector for the current default PHPUnit host when a PHP file is active.
- Top-level `phpunitDefault` config key.

## [0.2.0] — 2026-07-27

### Added
- **PHPUnit Remote Runner**: Run PHPUnit tests on remote SSH hosts directly from VS Code.
  - **Run All Tests**: Command palette (`SSH UI: Run All PHPUnit Tests`) or tree view context menu on any PHPUnit-enabled host.
  - **Run File**: CodeLens "▶ Run File" button above PHPUnit test class declarations, or via command palette.
  - **Run Test Method**: CodeLens "▶ Run Test" button above individual `public function test*()` and `#[Test]` annotated methods.
  - Output streamed live to a persistent **Output Channel** (`SSH UI — PHPUnit`).
  - Supports password auth (`SSH_ASKPASS` injection), key-based auth (`-i identityFile`), and terminal fallback when neither is configured.
  - Key-only runs use `-o BatchMode=yes` so SSH exits immediately on auth failure; saved-password runs use the forced private `SSH_ASKPASS` helper instead.
  - Per-host `phpunit` config key (`enabled`, `remotePath`, `bin`) — entirely optional, existing hosts unaffected.
  - **Edit PHPUnit Config** command available via host right-click context menu.
  - PHPUnit setup prompt integrated into the **Add Host** wizard.

## [0.1.2] — prior

- Encrypted SSH password storage via VS Code SecretStorage API.
- Multi-step Add Host wizard.
- Tree view with inline connect, save-password, remove-host actions.
- Config file watcher for real-time tree refresh.
