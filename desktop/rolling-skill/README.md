# Rolling Skill Desktop

This package turns the local Rolling Skill evaluation workbench into a genuine macOS desktop
client. Electron owns the native window and Docker Compose lifecycle; the existing Agenta web app
is loaded into that window only after the local HTTP endpoint is healthy.

## Build the double-clickable app

From the repository root:

```bash
bash desktop/rolling-skill/scripts/build-macos-app.sh
```

The generated, ad-hoc signed application is written to `Rolling Skill.app` at the repository root.
It is intentionally ignored because Electron makes the bundle roughly 275MB. The build is for Apple
Silicon and requires macOS 13 or newer.

## Develop

```bash
cd desktop/rolling-skill
npm install
npm test
npm start
```

The application discovers a checkout by scanning upward from its own bundle/executable. If the app
is moved elsewhere, choose the checkout from the startup screen or **Runtime → Choose Checkout…**.
The selection is saved in the application's preferences.

## Runtime and security model

- Docker Desktop remains a prerequisite and Compose remains the runtime boundary.
- Only `~/.codex/auth.json` is copied to `.local/codex-home/auth.json`; the host `.codex` directory
  and its Skills, plugins, apps, and configuration are never mounted.
- Evidence stays in `.local/codex-evidence/`; logs stay in `.local/desktop.log`.
- Renderer Node integration is disabled; context isolation and Chromium sandboxing are enabled.
- The privileged window only navigates within the configured `http://localhost` origin. External
  HTTPS links are handed to macOS and all other navigation is blocked.
- Closing the window or quitting the app leaves the runtime running. **Runtime → Stop Runtime** stops
  services without deleting volumes or evidence.

## Tests

`npm test` covers checkout discovery, fixed non-shell Compose invocation, loopback navigation, and
credential isolation, including refusal of a symlinked local credential directory. Packaging and
launch smoke tests are documented in the root README and OpenSpec change
`native-rolling-skill-desktop`.
