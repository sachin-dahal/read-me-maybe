// Runs the integration suite inside a real VS Code instance with a throwaway
// profile. Uses a locally installed VS Code when available, otherwise downloads one.
//   npm run test:integration
import { runTests } from '@vscode/test-electron';
import { existsSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const sandbox = mkdtempSync(join(tmpdir(), 'readmemaybe-it-'));
const workspace = join(sandbox, 'workspace');
cpSync(join(root, 'examples'), workspace, { recursive: true });

const localCode = [
  process.env.VSCODE_EXECUTABLE,
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
].find((p) => p && existsSync(p));

try {
  await runTests({
    vscodeExecutablePath: localCode,
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'test/integration/suite.cjs'),
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${join(sandbox, 'user-data')}`,
      `--extensions-dir=${join(sandbox, 'extensions')}`,
    ],
  });
} catch (err) {
  console.error('Integration tests failed', err);
  process.exit(1);
}
