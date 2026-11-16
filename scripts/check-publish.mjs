// Pre-publish checklist: `npm run check:publish`
// Fails (exit 1) on anything that would block or break a Marketplace / Open VSX release.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const PLACEHOLDER_PUBLISHER = 'readmemaybe';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const results = [];

/** level "error" blocks publishing, "warn" is a heads-up. */
function check(ok, label, hint, level = 'error') {
  results.push({ ok: Boolean(ok), label, hint, level });
}

function minVersion(range = '') {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(range);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function pngSize(path) {
  const buf = readFileSync(path);
  const isPng = buf.subarray(1, 4).toString('latin1') === 'PNG';
  return isPng ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : undefined;
}

function git(command) {
  try {
    return execSync(`git ${command}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

// --- package.json --------------------------------------------------------------
check(
  pkg.publisher && pkg.publisher !== PLACEHOLDER_PUBLISHER,
  `"publisher" is your own Marketplace ID (currently "${pkg.publisher}")`,
  'Create a publisher at https://marketplace.visualstudio.com/manage and put its ID in package.json.',
);

const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
check(
  /^https:\/\//.test(repoUrl ?? ''),
  '"repository" is an HTTPS git URL',
  'Add "repository": { "type": "git", "url": "https://github.com/<you>/read-me-maybe" }. The Marketplace needs it to show README images.',
);

// vsce points README images at the GitHub repo, so it has to be publicly readable.
const github = /github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/.exec(repoUrl ?? '');
if (github) {
  const [, owner, repo] = github;
  let status;
  try {
    status = (await fetch(`https://github.com/${owner}/${repo}`, { method: 'HEAD', signal: AbortSignal.timeout(8000) })).status;
  } catch {
    status = undefined; // offline: can't tell
  }
  if (status !== undefined) {
    check(
      status < 400,
      `github.com/${owner}/${repo} is public`,
      'The repository is private (or missing), so README screenshots and repo/support links will be broken on the Marketplace. Make it public: GitHub → Settings → General → Danger Zone → Change visibility.',
    );
  }
}

const packageScript = pkg.scripts?.package ?? '';
check(
  !repoUrl || !/--no-rewrite-relative-links|--allow-missing-repository/.test(packageScript),
  'the "package" script lets vsce rewrite README image links',
  'Now that "repository" is set, remove --no-rewrite-relative-links and --allow-missing-repository from the "package" script.',
);

check(
  compare(minVersion(pkg.devDependencies?.['@types/vscode']), minVersion(pkg.engines?.vscode)) <= 0,
  '@types/vscode is not newer than engines.vscode',
  'vsce refuses to package when @types/vscode is newer than the minimum VS Code version in "engines".',
);

// --- files ---------------------------------------------------------------------
const icon = pkg.icon && existsSync(pkg.icon) ? pngSize(pkg.icon) : undefined;
check(
  icon && icon.width >= 128 && icon.height >= 128,
  `icon is a PNG of at least 128×128 (${pkg.icon ?? 'missing'})`,
  'The Marketplace needs a PNG icon of at least 128×128 px. SVG icons are rejected.',
);

const readme = existsSync('README.md') ? readFileSync('README.md', 'utf8') : '';
check(readme.length > 0, 'README.md exists', 'Add a README.md; it becomes the Marketplace page.');
const svgImages = [...readme.matchAll(/(?:!\[[^\]]*\]\(|<img[^>]+src=")([^)"\s]+\.svg)/gi)].map((m) => m[1]);
check(svgImages.length === 0, 'README has no SVG images', `vsce rejects SVG images in the README: ${svgImages.join(', ')}`);

const changelog = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : '';
check(
  new RegExp(`^##\\s*\\[?${pkg.version.replace(/\./g, '\\.')}\\]?`, 'm').test(changelog),
  `CHANGELOG.md has a "## ${pkg.version}" section`,
  'Describe what changed in this version at the top of CHANGELOG.md.',
);

check(existsSync('LICENSE'), 'LICENSE exists', 'Add a LICENSE file.');

// --- git -----------------------------------------------------------------------
const dirty = git('status --porcelain');
check(dirty === '', 'git working tree is clean', 'Commit or stash your changes so the release matches a commit.', 'warn');
check(
  Boolean(git(`tag --list v${pkg.version}`)),
  `git tag v${pkg.version} exists`,
  `Run "npm version patch|minor|major" to bump the version and tag it, or "git tag v${pkg.version}".`,
  'warn',
);

// --- report --------------------------------------------------------------------
const errors = results.filter((r) => !r.ok && r.level === 'error');
const warnings = results.filter((r) => !r.ok && r.level === 'warn');
console.log(`\nReadMeMaybe publish check (v${pkg.version})\n`);
for (const r of results) {
  const mark = r.ok ? '✓' : r.level === 'error' ? '✗' : '!';
  console.log(`  ${mark} ${r.label}`);
  if (!r.ok) {
    console.log(`      → ${r.hint}`);
  }
}
console.log(
  errors.length === 0
    ? `\nReady to publish${warnings.length ? ` (${warnings.length} heads-up)` : ''}. 🚀\n`
    : `\n${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before publishing.\n`,
);
process.exit(errors.length === 0 ? 0 : 1);
