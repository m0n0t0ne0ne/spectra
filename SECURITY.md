# Security policy

## Supported versions

Only the latest release receives fixes. Update from the [releases page](https://github.com/m0n0t0ne0ne/spectra/releases/latest).

## Reporting a vulnerability

Please **don't** open a public issue. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository. Include the version (Targets → About), steps to reproduce, and the impact you expect. You'll get a reply within a few days.

## How Spectra is protected

**Data on the phone**
- All user data (diary, foods, weights, settings, USDA key) is stored in app-private files. Writes are atomic (`AtomicFile`), so a crash can't leave half-written data.
- `allowBackup="false"` plus data-extraction rules exclude everything from cloud backup and device transfer.
- The USDA key is never written to exports.

**Network**
- Cleartext traffic is disabled; only HTTPS is used.
- The web app is served from `https://appassets.androidplatform.net` through `WebViewAssetLoader`, with file and content access in the WebView turned off.
- A Content Security Policy allows scripts only from the app itself and network requests only to Open Food Facts, USDA and UPCitemdb. Fonts and the scanner library are bundled; there are no CDNs.
- Links can only open `http(s)` pages in the browser; other URL schemes are blocked.

**Builds and releases**
- The release keystore is never committed (`.gitignore` blocks `*.jks`, `*.keystore`, `keystore.properties`). CI decodes it from encrypted secrets in a protected `release` environment, uses it, and deletes it.
- The release workflow checks that the APK is signed with the official certificate before publishing, and publishes SHA-256 checksums.
- GitHub Actions are pinned to commit SHAs; Dependabot proposes updates weekly.
- Pull requests build without access to signing secrets.

## Official signing certificate

```
SHA-256: D3:83:DB:A8:E0:45:83:83:64:D0:5A:D6:3C:88:00:B5:78:89:F3:67:3F:9F:F7:8B:C9:F4:B4:69:6E:4F:6E:E6
```

An APK signed with any other certificate is not an official build.
