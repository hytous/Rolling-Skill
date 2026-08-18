# Rolling Skill app icons

- `icon-s-keycap-orange.svg` / `.png` is the active orange-white mechanical S-key app icon.
- `icon-spin-keycap.svg` / `.png` is the previous blue `S放` keycap icon and is intentionally retained for an immediate rollback.
- `icon.svg` / `icon.svg.png` is the earlier white-blue trace-merge icon and is also retained.

Change `build.mac.icon` in `package.json` to switch between them. Regenerate the active PNG with `npm run render:icon`.
