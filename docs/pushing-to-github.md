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

3. The tests run straight away, on that first push: see the Actions tab.

## Making a release with downloadable apps

1. Update `CHANGELOG.md` and push.
2. GitHub → **Releases** → **Draft a new release** → **Choose a tag** →
   type `0.1.0` (no `v`) → **Create new tag on publish** → write what changed →
   **Publish release**.
3. `release.yml` starts. It builds on a real Mac and a real Windows machine,
   runs every Python suite on each, packages the app, and runs the app's
   own `--selftest` on the result. Roughly ten minutes.
4. The two zips appear on the release page. That is what people download.

To try the whole thing without publishing anything: Actions → Release → **Run
workflow**, with **Rehearse the builds** chosen. It runs the same build and
the same checks, but leaves the zips as workflow artifacts instead of
attaching them to a release.

## Signing

**Neither build is signed.** Users get one warning on first launch: on macOS
right-click → Open, on Windows "More info" → "Run anyway". Signing needs an
Apple Developer account ($99/year) and an Authenticode certificate. Both fit
into `release.yml` as extra steps and repository secrets when you want them.
