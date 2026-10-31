# Security

## Reporting a vulnerability

Please do not open a public issue containing API keys, DSH credentials, cookies, full logs, complete profile files, or other secrets.

Use GitHub's private vulnerability reporting / security advisory for this repository when available. Include:

- affected version / commit;
- DSH version and whether you use the Desktop client or `dsh web`;
- reproduction steps;
- a redacted description of the impact.

## Scope notes

- Every `/dsh-whale/*` route requires the host's `connection.requestRejection(req)` admission API. Missing services/methods, lookup/call failures, and unexpected return values deny access with HTTP 503. Only the documented `undefined` result admits a request; host 401/403 rejections are preserved. There is no loopback/Origin-only fallback.
- This plugin reads, sets, and unsets API-key references through the host's credential service. References are limited to built-in provider names or custom names prefixed with `DSHW_`; structured credential records cannot be deleted. API keys are not stored in plugin configuration files.
- Runtime data is written under `$DSH_HOME`, not into this repository.
- Writes require both a loopback socket peer and a loopback Host, or an explicitly configured `DSHW_ADMIN_HOSTS` authority, after successful host admission. Proxy forwarding headers are not used to establish a local peer. A local reverse proxy must enforce management access at its own ingress; a loopback upstream socket cannot establish the original client's location.
- Every route has an HTTP method allowlist. Resource deletion, pinning, and upload reject GET/HEAD with 405. Model IDs reject prototype keys, and recursively sanitized configuration objects cannot write prototype setters.
- Custom HTTP(S) endpoints may target local models and private gateways. Metadata, unspecified, link-local, and multicast IPs (including IPv4-mapped IPv6) are blocked; every DNS answer is checked and the validated answers are passed directly to the socket lookup. API redirects are refused and response bodies are bounded at 2 MiB.
- `DSHW_TRUSTED_HOSTS` no longer provides a compatibility bypass. Host trust remains the host's responsibility; `DSHW_ADMIN_HOSTS` never bypasses authentication.

## Regression checks

Run `npm test` (Node's built-in test runner; no additional packages). Tests use fake credentials, mocked transports, a temporary loopback HTTP server, and a disposable directory under `test/`. They cover all registered routes with unavailable authentication, host rejections, socket/Host checks, method restrictions, credential scope, prototype pollution, DNS pinning, mapped IPs, and redirect refusal. They do not access the installed DSH profile or send external requests.
