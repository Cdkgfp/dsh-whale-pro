# Security

## Reporting a vulnerability

Please do not open a public issue containing API keys, DSH credentials, cookies, full logs, complete profile files, or other secrets.

Use GitHub's private vulnerability reporting / security advisory for this repository when available. Include:

- affected version / commit;
- DSH version and whether you use the Desktop client or `dsh web`;
- reproduction steps;
- a redacted description of the impact.

## Scope notes

- This plugin reads DeepSeek/DSH credentials through the host's credential service. It does not store API keys in its own configuration files.
- Runtime data is written under `$DSH_HOME`, not into this repository.
- The plugin's write routes are intended for local (`127.0.0.1` / `localhost`) use; do not expose the DSH web server to untrusted networks without reviewing the host's own security model.
