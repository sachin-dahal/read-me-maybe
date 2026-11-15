# Before publishing

How to ship ReadMeMaybe to the **VS Code Marketplace** and **Open VSX** (where Antigravity, Cursor and VSCodium get their extensions).

At any point, run:

```bash
npm run check:publish
```

It lists what's ready and what still needs fixing.

## 1. One-time setup

1. **Pick a publisher ID.** Sign in at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and click **Create publisher**. The ID is permanent, so choose carefully. Put it in `package.json` → `"publisher"` (right now it's the placeholder `readmemaybe`).
2. **Push the repo to GitHub** and add it to `package.json`:

   ```json
   "repository": { "type": "git", "url": "https://github.com/<you>/read-me-maybe" },
   "bugs": { "url": "https://github.com/<you>/read-me-maybe/issues" },
   "homepage": "https://github.com/<you>/read-me-maybe#readme"
   ```

   The Marketplace needs this to show the README screenshots. Then remove `--no-rewrite-relative-links` and `--allow-missing-repository` from the `package` script.
3. **Set up Open VSX.**
   1. Create an [Eclipse account](https://accounts.eclipse.org/user/register) using the same GitHub username you'll use on open-vsx.org.
   2. Sign in at [open-vsx.org](https://open-vsx.org) with GitHub. On your profile, click **Log in with Eclipse**, then sign the **Publisher Agreement**.
   3. Under **Settings → Access Tokens**, generate a token and copy it (it's only shown once).
   4. Create the namespace once. It must match your publisher ID:

      ```bash
      npx ovsx create-namespace <publisher> -p <open-vsx-token>
      ```

      To get the "verified" badge, claim the namespace separately (see the Open VSX wiki's *Namespace Access* page).
4. Optional: update the copyright line in `LICENSE`.

> [!IMPORTANT]
> Azure DevOps **retires global Personal Access Tokens on December 1, 2026**, so the old `vsce login` + token flow is on its way out. Use one of the options in step 3 below instead.

## 2. Every release

1. Add a `## <new version>` section to `CHANGELOG.md`.
2. Run the tests:

   ```bash
   npm test                  # unit tests
   npm run test:integration  # runs inside a real VS Code
   VSCODE_EXECUTABLE="/Applications/Antigravity IDE.app/Contents/MacOS/Electron" npm run test:integration  # and in Antigravity
   ```

3. Build the package and install it locally (`code --install-extension read-me-maybe-<version>.vsix`). Click through `examples/kitchen-sink.md`.
4. Bump the version and tag it: `npm version patch` (or `minor` / `major`).
5. `npm run check:publish` should come back clean.

## 3. Publish

Pick one.

**A. By hand (simplest for the first release)**

```bash
npm run package
```

- **Marketplace:** on [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage), open your publisher, click **New extension → Visual Studio Code**, and upload the `.vsix`.
- **Open VSX:** `npx ovsx publish read-me-maybe-<version>.vsix -p <open-vsx-token>`

**B. Automatically from GitHub (recommended after that)**

`.github/workflows/publish.yml` runs the tests, packages, and publishes to both stores whenever you push a `v*` tag.

1. On the Marketplace publisher page, set up **Trusted Publishing** for your GitHub repository and the `publish.yml` workflow. No token is needed.
2. In the GitHub repo, add a secret named `OVSX_PAT` with your Open VSX token.
3. Release with:

   ```bash
   npm version minor
   git push --follow-tags
   ```

New versions usually show up in both stores within a few minutes.

## Working on the extension

```bash
npm install
npm run dev               # browser harness at http://localhost:5179 with a fake VS Code host
npm run watch             # rebuild on change; press F5 in VS Code to launch the Extension Development Host
npm test                  # unit tests
npm run test:integration  # integration tests in a real VS Code
npm run package           # build read-me-maybe-<version>.vsix
```
