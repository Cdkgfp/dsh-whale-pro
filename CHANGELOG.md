# Changelog

## 0.4.4 — backend security fixes

- Require host admission for every plugin route; missing or failed authentication now denies access instead of falling back to Host/Origin checks. Preserve host 401/403 responses.
- Require real loopback connections for local writes, keep explicitly configured authenticated admin authorities, and enforce per-route HTTP methods.
- Restrict credential references to built-in provider names or the `DSHW_` namespace, remove structured-record deletion fallback, and preserve built-in DeepSeek key updates without endpoint overrides.
- Reject unsafe/unknown model IDs and inherited provider names; recursively sanitize configuration keys to prevent prototype pollution.
- Block mapped metadata/link-local addresses, validate and pin DNS answers for API requests, refuse redirects, and cap responses at 2 MiB. Local models and private gateways remain supported.
- Remove invalid `undefined...` runtime-data fallback paths and add dependency-free backend security regression tests.

## 0.4.3 — dsh-whale-pro

- Renamed the plugin package, DSH mount id and GitHub repository to `dsh-whale-pro`.
- Added README screenshots for the compact panel and the settings page (`docs/`).
- Updated install/config references and version metadata for the renamed package.
- Reinstalled into the DSH desktop profile as `dsh-whale-pro`; users upgrading from `dsh-whale-compact` should remove the old package before adding the new one.

## 0.4.2 — compact fork

- Added a compact balance/peak-valley/current-time panel above the whale.
- Removed the manual click bubble; retained automatic bubbles for balance changes, questions, turn cost, approvals, alerts and budget.
- Added an inline settings page, replacing the old sound/settings popups:
  - Appearance: role, scale, role image management.
  - Behavior: scrollbar gap, menu-button visibility, text-panel switch.
  - Sound: master switch, press/task-end/question/approval sounds, audio resources.
  - Auto bubbles: master switch, six scenarios, bubble image library.
- Added capsule toggles, category separators and immediate-save controls.
- Restored today-usage accounting and sound settings after the compact-panel refactor.
- Removed the snap/flip settings row, resource-management row and the version/about statistics panel.
- Aligned the sound-row controls and increased the settings-page width/row spacing for readability.

Based on `DeepSeek-Balance-Whale-Widget` 0.4.2 by MeteorNOX and contributors.
