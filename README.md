# Orel

A cross-platform database GUI built with Tauri and React.

## Publishing a release

Releases are created only when a semantic version tag is pushed. The tag must match the `version` in `package.json`.

Before the first release, add the updater signing credentials to the GitHub repository as secrets named
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep an offline backup of both values; losing
them prevents existing installations from accepting future updates. Never commit the private key.

To publish a release:

```bash
# First update package.json and src-tauri/Cargo.toml to the new version, then commit it.
RELEASE_VERSION="$(node -p "require('./package.json').version")"
git tag "v${RELEASE_VERSION}"
git push origin main "v${RELEASE_VERSION}"
```

GitHub Actions builds macOS, Windows, and Linux packages, creates the GitHub Release, and publishes the signed
`latest.json` manifest used by the in-app updater.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
