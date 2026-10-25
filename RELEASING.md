# Releasing Spectra

## One-time setup: the signing key

Android only installs an update if it's signed with the **same key** as the installed app. Lose the key and nobody can update their Spectra; leak it and someone else can publish "updates". Treat it like a password to every user's phone.

You need two things:

- `spectra-release.jks`: the keystore (alias `spectra`, RSA 4096, valid until 2056).
- Its password (the key uses the same password).

### 1. Keep two offline backups

Store the keystore file and the password in a password manager (for example as an attachment plus a password entry), and keep a second copy somewhere separate, such as an encrypted USB drive. Never put either in the repository, an issue, or chat.

### 2. Add them to GitHub

1. In the repository: **Settings → Environments → New environment**, name it `release`.
2. Optional: add yourself as a **required reviewer** if you want to approve each release before it's published. If you limit **Deployment branches and tags**, allow the `main` branch.
3. In that environment, **Add environment secret** twice:
   - `SPECTRA_KEYSTORE_BASE64`: the keystore as base64. On macOS/Linux: `base64 -i spectra-release.jks | tr -d '\n'`; on Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("spectra-release.jks"))`.
   - `SPECTRA_KEYSTORE_PASSWORD`: the password.

### 3. Turn on the website

**Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main**, folder **/docs**. The site appears at https://m0n0t0ne0ne.github.io/spectra/.

### 4. Protect the main branch (recommended)

**Settings → Rules → Rulesets → New branch ruleset** for `main`: block force pushes and deletions, and require the **CI** check to pass.

## Publishing a release

Releases are automatic. Nobody creates tags or releases by hand.

1. Make the changes. Update anything user-facing (website text, screenshots with `python3 tools/screenshots.py`).
2. Set the new version in **three** places: the `VERSION` file, `APP_VERSION` in `web/js/app.js`, and the cache name in `web/sw.js` (for example `1.0.2`, `'1.0.2'`, `spectra-1.0.2`).
3. Optional: write the release notes in `.github/release-notes/v1.0.2.md`; otherwise GitHub generates them.
4. Push to `main`.

The **Release** workflow sees a version that hasn't been released yet. It builds the APK (`1.0.2` → versionCode `10002`), signs it, verifies the certificate, creates the `v1.0.2` tag and publishes `Spectra.apk`, `Spectra-1.0.2.apk`, `SHA256SUMS.txt` and `signing-certificate.txt`. Pushes that don't change `VERSION` do nothing.

To rebuild an existing release, run the **Release** workflow manually from the Actions tab and enter its tag (for example `v1.0.1`).

## Building a signed APK locally

Create `android/keystore.properties` (git-ignored):

```properties
SPECTRA_KEYSTORE_FILE=/absolute/path/to/spectra-release.jks
SPECTRA_KEYSTORE_PASSWORD=…
SPECTRA_KEY_ALIAS=spectra
SPECTRA_KEY_PASSWORD=…
```

Then `cd android && VERSION_NAME=1.0.1 ./gradlew assembleRelease`. Without that file the release build is unsigned.

## If the key is ever exposed

1. Remove the GitHub secrets and rotate them.
2. Android doesn't allow changing an app's key in place for sideloaded APKs, so publish a notice on the website and README with the date, and treat later builds signed with the old key as suspect.
3. Consider a new app ID with a new key, and ask users to move their data with Export → Import.
