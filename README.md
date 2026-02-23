# SSH UI

**SSH UI** is a Visual Studio Code extension that lets you manage and connect to SSH servers directly from the editor. Add hosts, save passwords securely, and connect with one click.

![VS Code](https://img.shields.io/badge/VS%20Code-^1.96.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **SSH server list** — View all configured servers with name, user, host, and port details in the sidebar.
- **Add / Remove hosts from the UI** — Multi-step wizard to add new SSH hosts; remove with one click.
- **One-click connection** — Click any host or use the plug icon to open an SSH session in the integrated terminal.
- **Secure password storage** — Passwords are stored in your OS credential store via VS Code's SecretStorage API. Never stored in plain text.
- **Auto-login with saved passwords** — Uses `expect` to automatically enter your password when connecting.
- **Customizable configuration** — Edit the JSON config file directly for bulk changes.

## Getting Started

1. **Install** the extension from the VS Code Marketplace.
2. **Open the SSH Hosts view** in the Activity Bar (look for the SSH icon).
3. **Click the + button** in the title bar to add your first host.

## Usage

| Action | How |
|---|---|
| **Add a host** | Click **+** in the SSH Hosts title bar → follow the 5-step wizard |
| **Connect** | Click a host row, or click the **plug** icon |
| **Save password** | Click the **key** icon on a host row |
| **Remove a host** | Click the **trash** icon on a host row |
| **Edit config** | Command Palette → `SSH UI: Edit configuration file` |

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
      "identityFile": "~/.ssh/id_rsa"
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

## Requirements

- **VS Code** 1.96.0 or later
- **expect** (pre-installed on macOS and most Linux distributions) — required for auto-login with saved passwords

## Security

- Passwords are stored using VS Code's built-in **SecretStorage API**, which delegates to your OS credential store (macOS Keychain, Windows Credential Vault, Linux Secret Service).
- Passwords are **never** stored in the configuration file or logged.
- During auto-login, the password is passed via an environment variable and terminal output is suppressed while sending credentials.

## License

[MIT](LICENSE)
