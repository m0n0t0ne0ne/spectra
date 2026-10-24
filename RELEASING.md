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
2. Optional but recommended: under **Deployment branches and tags**, choose **Selected branches and tags** and add the tag rule `v*.*.*`. Add yourself as a **required reviewer** if you want to approve each release.
3. In that environment, **Add environment secret** twice:
   - `SPECTRA_KEYSTORE_BASE64`: the keystore as base64. On macOS/Linux: `base64 -i spectra-release.jks | tr -d '\n'`; on Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("spectra-release.jks"))`.
   - `SPECTRA_KEYSTORE_PASSWORD`: the password.

### 3. Turn on the website

**Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main**, folder **/docs**. The site appears at https://m0n0t0ne0ne.github.io/spectra/.

### 4. Protect the main branch (recommended)

**Settings → Rules → Rulesets → New branch ruleset** for `main`: block force pushes and deletions, and require the **CI** check to pass.

## Publishing a release

1. Update anything user-facing (website text, screenshots with `python3 tools/screenshots.py`, the privacy policy date if it changed).
2. Bump `APP_VERSION` in `web/js/app.js` and the cache name in `web/sw.js` to the new version.
3. Commit and push to `main`; wait for **CI** to pass.
4. Tag and push:
   ```bash
   git tag -a v1.0.1 -m "Spectra 1.0.1"
   git push origin v1.0.1
   ```
5. Optional: write the release notes in `.github/release-notes/v1.0.1.md` before tagging; otherwise GitHub generates them.
6. The **Release** workflow builds the APK with `VERSION_NAME` from the tag (`1.0.1` → versionCode `10001`), signs it, verifies the certificate, and publishes `Spectra.apk`, `Spectra-1.0.1.apk`, `SHA256SUMS.txt` and `signing-certificate.txt` with generated notes. Edit the notes on GitHub if you like.

To rebuild an existing tag, run the **Release** workflow manually and enter the tag.

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
