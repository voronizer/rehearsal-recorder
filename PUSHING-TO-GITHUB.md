# Putting this on GitHub

This folder is already a git repository with one commit on `main`, so there
is nothing to set up — only somewhere to push it.

1. Make an empty repository on GitHub. **No** README, license or .gitignore:
   they are all here already and GitHub's would collide.

2. Point this at it and push:

   ```bash
   cd rehearsal-recorder
   git remote add origin https://github.com/YOUR-NAME/rehearsal-recorder.git
   git push -u origin main
   ```

3. The tests run straight away, on that first push — Actions tab.

## Making a release with downloadable apps

1. Update `CHANGELOG.md` and push.
2. GitHub → **Releases** → **Draft a new release** → **Choose a tag** →
   type `v0.1.0` → **Create new tag on publish** → write what changed →
   **Publish release**.
3. `release.yml` starts. It builds on a real Mac and a real Windows machine,
   runs all three test suites on each, packages the app, and runs the app's
   own `--selftest` on the result. Roughly ten minutes.
4. The two zips appear on the release page. That is what people download.

To try the whole thing without publishing anything: Actions → Release → **Run
workflow**. Same build and same checks, but the zips are left as workflow
artifacts instead of being attached to a release.

## Two things worth knowing

**The first Windows build happens on GitHub.** There was no Windows machine
in the environment this was written in. The code takes the right branches —
that is what `tests/test_platform.py` checks — but taking the right branch is
not the same as working. Expect the first Windows run to find something.

**Neither build is signed.** Users get one warning on first launch: on macOS
right-click → Open, on Windows "More info" → "Run anyway". Signing needs an
Apple Developer account ($99/year) and an Authenticode certificate. Both fit
into `release.yml` as extra steps and repository secrets when you want them.

You can delete this file once it is up.
