# Putting this on GitHub

This folder is already a git repository with its history on `main`, so all
it needs is somewhere to push it.

1. Make an empty repository on GitHub. **No** README, license or .gitignore:
   they are all here already and GitHub's would collide.

2. Point this at it and push:

   ```bash
   cd rehearsal-recorder
   git remote add origin https://github.com/YOUR-NAME/rehearsal-recorder.git
   git push -u origin main
   ```

3. On that first push the website's and the band service's checks run: see
   the **Actions** tab. РЭХА's own checks run on each pull request that
   changes it.

## Making a release with downloadable apps

1. Update `CHANGELOG.md` and push.
2. GitHub → **Releases** → **Draft a new release** → **Choose a tag** →
   type `0.1.0` (no `v`) → **Create new tag on publish** → write what changed →
   **Publish release**.
3. `reha.yml` starts. For the few minutes the builds take, it makes the
   release before (when there is one) “Latest” again, so the download
   buttons and the app's own update check keep offering a version that has
   its zips. It builds on a real Mac and a real Windows machine, runs every
   Python suite on each, packages the app, and runs the app's own
   `--selftest` on the result. Roughly ten minutes.
4. The two zips appear on the release page. That is what people download.
   The release is “Latest” again, and the website goes up for it.

To try the whole thing without publishing anything: Actions → **Reha** →
**Run workflow**, with **Rehearse the builds** chosen. It runs the same build and
the same checks, but leaves the zips as workflow artifacts instead of
attaching them to a release.

## Signing

**Neither build is signed.** Users get one warning on first launch: on macOS
right-click → Open, on Windows "More info" → "Run anyway". Signing needs an
Apple Developer account ($99/year) and an Authenticode certificate. Both fit
into `reha.yml` as extra steps and repository secrets when you want them.
