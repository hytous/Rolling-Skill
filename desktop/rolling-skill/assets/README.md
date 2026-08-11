# Rolling Skill app icons

- `icon-spin-keycap.svg` / `.png` is the active macOS app icon.
- `icon.svg` / `icon.svg.png` is the previous white-blue trace-merge icon and is intentionally retained for an immediate rollback.

Change `build.mac.icon` in `package.json` to switch between them. Regenerate the active PNG with `npm run render:icon`.
