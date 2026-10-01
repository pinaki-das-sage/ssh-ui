# Remote Toolkit

**Remote Toolkit** is a Visual Studio Code extension for managing remote development workflows from one place. Connect over SSH, transfer files with verified SFTP servers, and run PHPUnit tests on remote hosts.

![VS Code](https://img.shields.io/badge/VS%20Code-^1.96.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Remote host list** — View all configured servers with name, user, host, and port details in the sidebar.
- **Add / Remove hosts from the UI** — Multi-step wizard to add new SSH hosts; remove with one click.
- **One-click connection** — Click any host or use the plug icon to open an SSH session in the integrated terminal.
- **Secure password storage** — Passwords are stored in your OS credential store via VS Code's SecretStorage API. Never stored in plain text.
- **Auto-login with saved passwords** — Uses `SSH_ASKPASS` to provide your saved password when connecting.
- **Customizable configuration** — Edit the JSON config file directly for bulk changes.
- **SFTP file operations** — Upload the active file, download a remote file, or list a remote directory.

## Getting Started

1. **Install** the extension from the VS Code Marketplace.
2. **Open the Remote Toolkit view** in the Activity Bar (look for the terminal-and-server icon).
3. **Click the + button** in the title bar to add your first host.

## Usage

| Action | How |
|---|---|
| **Add a host** | Click **+** in the Remote Toolkit title bar → follow the 5-step wizard |
| **Connect** | Click a host row, or click the **plug** icon |
| **Save password** | Click the **key** icon on a host row |
| **Remove a host** | Click the **trash** icon on a host row |
| **Edit config** | Command Palette → `Remote Toolkit: Edit configuration file` |

## PHPUnit Remote Runner

Run PHPUnit tests on remote servers directly from VS Code, using the same stored credentials as your SSH connections.

### Setup

1. Right-click any SSH host in the tree and choose **Edit PHPUnit Config**, or configure during **Add Host**.
2. Enter the **remote project root path** (e.g. `/var/www/myapp`) and the **PHPUnit binary** (e.g. `./vendor/bin/phpunit`).

For remote PHPUnit, use an equivalent helper, as `phpunit`. Configure its absolute server path (for example, `/home/your-user/bin/phpunit` rather than `~/bin/phpunit`); the wrapper establishes the required server environment, so no environment variables belong in Remote Toolkit configuration.

### Create the remote PHPUnit wrapper

On the remote development server, create `~/bin/phpunit` once. This wraps the shared PHP interpreter, PHPUnit phar, and bootstrap in the same way as the PhpStorm remote-interpreter setup:

```bash
mkdir -p ~/bin
cat > ~/bin/phpunit <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

exec /home/your-user/bin/php84_wrapper \
  /home/your-user/bin/phpunit-9.5.13.phar \
  --bootstrap /home/your-user/bin/bootstrap.php \
  "$@"
EOF
chmod 700 ~/bin/phpunit
~/bin/phpunit --version
```

If your server provisions different shared paths or PHP versions, use the matching wrapper, PHPUnit phar, and bootstrap paths from its PhpStorm setup. Then configure the wrapper's **absolute** path in Remote Toolkit, for example: `"bin": "/home/your-user/bin/phpunit"`.

The `phpunit` key is added to your host entry:

```json
{
  "name": "My Server",
  "host": "server.example.com",
  "port": 22,
  "user": "admin",
  "phpunit": {
    "enabled": true,
    "remotePath": "/var/www/myapp",
    "bin": "/home/your-user/bin/phpunit"
  }
}
```

### Running Tests

| How | Scope |
|-----|-------|
| Tree view context menu → **Run All PHPUnit Tests** | All tests on that host |
| Command Palette → `Remote Toolkit: Run All PHPUnit Tests` | All tests (prompts for host if multiple configured) |
| Command Palette → `Remote Toolkit: Select SFTP Target for PHPUnit` | Selects the SFTP target used automatically by CodeLens and palette runs |
| CodeLens **▶ Run File** above a test class | All tests in that file |
| Command Palette → `Remote Toolkit: Run PHPUnit: This File` | File in active editor |
| Explorer → right-click a workspace file → **Run PHPUnit: This File** | All tests in that file |
| CodeLens **▶ Run Test** above a test method | Single test method |
| Explorer → right-click a workspace folder → **Run PHPUnit Tests in Folder** | All tests discovered under that folder |

All output streams live to the **Remote Toolkit — PHPUnit** Output Channel (View → Output, select "Remote Toolkit — PHPUnit").

### CodeLens Buttons

When you open a PHP test file, clickable buttons appear inline:

- **▶ Run File** — appears above `class FooTest extends TestCase`
- **▶ Run Test** — appears above each `public function test*()` or `#[Test]` annotated method

CodeLens buttons only appear when at least one PHPUnit-enabled host is configured.

### PHPUnit Host Selection

The currently selected SFTP target is the default host for PHPUnit CodeLens and Command Palette runs. Select it with **Remote Toolkit: Select SFTP Target** (or **Select SFTP Target for PHPUnit**) and ensure that host also has `phpunit.enabled: true`. Do not add or edit a target in the configuration file manually.

- The left status bar label is **`RT-<hostname>`**; click it to change the SFTP target.
- When a PHP file is active, the PHPUnit status item shows the same selected host and also opens the SFTP target picker.
- An existing `phpunitDefault` value is retained only as a compatibility fallback when no selected SFTP target is PHPUnit-enabled.

Example:

```json
{
  "hosts": [
    {
      "name": "my-remote-project",
      "host": "server.example.com",
      "port": 22,
      "user": "admin",
      "sftp": {
        "remotePath": "/var/www/myapp"
      },
      "phpunit": {
        "enabled": true,
        "remotePath": "/var/www/myapp",
        "bin": "./vendor/bin/phpunit"
      }
    }
  ]
}
```

### Authentication

The runner uses the same credentials as SSH connections:

| Auth type | How |
|-----------|-----|
| Password (stored via key icon) | Injected silently via `SSH_ASKPASS` |
| Key file (`identityFile`) | Passed via `-i` flag — no password prompt |
| Neither configured | Falls back to an interactive terminal |

Password-backed output runs permit only the extension's forced private `SSH_ASKPASS` helper; key-only runs retain SSH batch mode so an unavailable credential fails promptly instead of waiting for input.

## Upcoming: AI-Assisted PHPUnit Runs

A future, opt-in MCP integration will allow approved AI agents to request the same PHPUnit scopes already available in the UI: all tests, one file, or one folder. It is not available in the current release.

The planned integration will keep the security boundary inside Remote Toolkit:

- Agents will provide only a workspace-relative file or folder path; paths outside the workspace will be rejected.
- Remote Toolkit will resolve the selected SFTP/PHPUnit host and use its existing SecretStorage credential internally. Passwords and private keys will never be returned to an AI tool.
- Each remote execution will require explicit user confirmation.
- The tool will return PHPUnit output and its exit code, enabling an agent to diagnose a failing test without reading credentials.

## SFTP

Enable SFTP for a host by adding an `sftp` section:

```json
{
  "name": "My Server",
  "host": "server.example.com",
  "port": 22,
  "user": "admin",
  "sftp": {
    "remotePath": "/var/www/myapp",
    "syncMode": "update",
    "ignore": [".vscode", ".git", "node_modules"],
    "uploadOnAutoSave": false
  }
}
```

| Field | Required | Description |
|---|---|---|
| `remotePath` | Yes | Remote directory to sync/upload/download against |
| `hostFingerprint` | No | Optional, strict SHA-256 server-key override formatted as `SHA256:<base64>`. Use it for centrally managed configurations. Without it, Remote Toolkit shows the server key on first connection and stores the key you explicitly trust in VS Code SecretStorage. |
| `syncMode` | No | `"update"` (default) — only upload files newer than the remote copy. `"mirror"` — also **deletes** remote files that no longer exist locally (destructive; asks for confirmation before running) |
| `ignore` | No | Plain names (not globs) excluded anywhere in the path, e.g. `node_modules` matches `src/node_modules` too |
| `uploadOnAutoSave` | No | If `true`, autosave (delay/focus-change) triggers an upload too. Default: only explicit `Ctrl+S` saves upload |

### Selecting a sync target

Since a workspace may have multiple SFTP-configured hosts, pick which one is "active" via:

- Command Palette → **Remote Toolkit: Select SFTP Target**
- Or click the **`RT-<hostname>`** item in the status bar (bottom left) to change it

The selection persists across sessions (stored in the config file) and is used by save-triggered uploads, `Upload Active File`, `Download File`, `List SFTP Directory`, and `Sync Folder`.

### Server-key trust

On the first SFTP connection to a host and port, Remote Toolkit displays its SHA-256 server-key fingerprint before authentication and asks whether to trust it. An accepted key is stored in VS Code SecretStorage; later connections must match it. If the key changes, the connection is blocked until you explicitly choose **Replace Trusted Key** after independently verifying the change.

For shared or managed environments, set `sftp.hostFingerprint` to make that configuration value the strict source of truth and suppress the trust prompt.

### Commands

| Command | What it does |
|---|---|
| **Remote Toolkit: Select SFTP Target** | Choose which SFTP-configured host is active |
| **Remote Toolkit: Upload Active File via SFTP** | Force-uploads the current file, regardless of `syncMode` |
| **Remote Toolkit: Download File via SFTP** | Prompts for a remote path, then a local save location |
| **Remote Toolkit: List SFTP Directory** | Lists a remote directory in the `Remote Toolkit — SFTP` output channel |
| **Remote Toolkit: Sync Folder via SFTP** | Syncs the entire workspace folder to `sftp.remotePath`, respecting `ignore` and `syncMode` |

### Upload on save

Once a target is selected, saving a file inside that host’s workspace uploads it automatically. Missing remote parent directories are created first:

- **Manual save (`Ctrl+S`)**: always uploads (default behavior, no config needed)
- **Autosave** (delay/focus-change): only uploads if `sftp.uploadOnAutoSave` is `true` for the target host

Files matching `sftp.ignore` are never uploaded, whether saved manually or automatically.

### Path Mapping


The runner assumes your local workspace file paths mirror the remote directory structure under `remotePath`. If you open `tests/FooTest.php` locally, the runner sends `tests/FooTest.php` as the relative path on the remote server.

For a folder run, Remote Toolkit similarly sends the selected workspace-relative folder (for example, `app/tests/<source-folder>`) to the configured PHPUnit wrapper. PHPUnit performs its normal recursive test discovery below that directory.

## Auto-Reconnect (Opt-In)

By default, SSH terminals behave exactly as before — if the connection drops, the terminal simply closes/exits like a normal shell session.

You can opt a host into **PuTTY-style reconnect on keypress**: if the SSH connection is broken, the terminal stays open and shows a "Press any key to reconnect" message. Pressing any key immediately re-establishes the connection.

Enable it per host:

```json
{
  "name": "My Server",
  "host": "192.168.1.10",
  "port": 22,
  "user": "admin",
  "reconnect": true
}
```

**How it works**: this uses a native pseudoterminal (`node-pty`) instead of the standard integrated terminal, so the extension can detect when the SSH process exits and intercept the next keystroke. Everything else (password/key auth, `SSH_ASKPASS`) works the same way.

**Platform note**: `node-pty` is a native module. On Windows, Remote Toolkit directly uses the installed Windows OpenSSH client at `%SystemRoot%\System32\OpenSSH\ssh.exe` for reconnecting terminals; it does not depend on `PATH` lookup. If that executable is not installed, or if `node-pty` fails to load on any platform/architecture, Remote Toolkit shows a warning and automatically opens the standard non-reconnecting terminal instead—even when `reconnect` is `true`.

## Configuration

The extension stores host configurations in `~/.vscode-ssh-ui-config.json`:

```json
{
  "hosts": [
    {
      "name": "My Server",
      "host": "192.168.1.10",
      "port": 22,
      "user": "admin",
      "identityFile": "~/.ssh/id_rsa",
      "sftp": {
        "remotePath": "/var/www/myapp"
      }
    }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Display name shown in the sidebar |
| `host` | Yes | Hostname or IP address |
| `port` | Yes | SSH port (default: 22) |
| `user` | Yes | SSH username |
| `identityFile` | No | Path to SSH private key |
| `reconnect` | No | Set to `true` to offer reconnect-on-keypress after a disconnect (requires `node-pty`). |
| `phpunitDefault` | No | Legacy PHPUnit fallback, used only when no selected SFTP target has PHPUnit enabled |

When you select a target through the Command Palette or the `RT-<hostname>` status-bar item, Remote Toolkit persists its internal selection as `sftpTarget` in the file. This is extension-managed state, not a user configuration field; use the picker to change or clear it.

## Requirements

- **VS Code** 1.96.0 or later
- **OpenSSH** 8.4 or later (for auto-login with saved passwords) — ships with Windows 10/11, macOS, and most Linux distributions

## Packaging and extension size

The published VSIX intentionally includes its runtime `node_modules`: SFTP needs `ssh2-sftp-client`, and reconnecting terminals need `node-pty` plus its native macOS and Windows artifacts. The packaging rules exclude `node-pty` build inputs, source, TypeScript declarations, source maps, tests, documentation, and Windows `.pdb` debug symbols; they retain the JavaScript loader, `.node` binaries, `spawn-helper`, Windows DLLs, and `winpty-agent.exe`.

Package a release with:

```bash
npx --no-install vsce package --out /private/tmp/remote-toolkit-<version>.vsix
```

`vsce` may still suggest bundling because the native runtime has many JavaScript files. That is a generic advisory, not a failure: do not remove runtime `node_modules` or native helpers to silence it. Before publishing, inspect `vsce`'s file list and verify reconnecting SSH on macOS and Windows plus SFTP on a real configured host.

## Security

- Passwords are stored using VS Code's built-in **SecretStorage API**, which delegates to your OS credential store (macOS Keychain, Windows Credential Vault, Linux Secret Service).
- Passwords are **never** stored in the configuration file or logged.
- During SSH and PHPUnit auto-login, the password is passed through a per-connection environment variable to a private `SSH_ASKPASS` helper; the helper contains no password and is removed when the terminal or PHPUnit process ends.
- SFTP asks for explicit trust before the first authenticated connection, stores the accepted server key in SecretStorage, and blocks unexpected changes. A configured `sftp.hostFingerprint` is an optional strict override for managed hosts.

## License

[MIT](LICENSE)
