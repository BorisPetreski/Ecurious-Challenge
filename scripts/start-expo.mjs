import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mobileEnvironment } from './mobile-environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try { process.loadEnvFile(resolve(root, '.env')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const cli = resolve(root, 'mobile/node_modules/expo/bin/cli');
if (!existsSync(cli)) {
  console.error('Install the mobile dependencies first: npm --prefix mobile ci');
  process.exit(1);
}
const child = spawn(process.execPath, [cli, 'start', '--go', '--lan', ...process.argv.slice(2)], {
  cwd: resolve(root, 'mobile'), stdio: 'inherit', env: mobileEnvironment(process.env),
});
child.on('error', () => { console.error('Could not start Expo.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
