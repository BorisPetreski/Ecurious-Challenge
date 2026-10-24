import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { mobileEnvironment } from './mobile-environment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (!existsSync(resolve(root, 'mobile/node_modules/expo/package.json'))) {
  console.error('Install the mobile dependencies first: npm --prefix mobile ci');
  process.exit(1);
}

const apiPort = process.env.PORT || '3000';
if (!/^\d+$/.test(apiPort) || Number(apiPort) < 1 || Number(apiPort) > 65535) {
  console.error('PORT must be a whole number from 1 to 65535.');
  process.exit(1);
}
const children = new Set();
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function run(command, args, env, cwd = root) {
  const child = spawn(command, args, { cwd, stdio: 'inherit', env });
  children.add(child);
  child.on('error', error => {
    console.error(`Could not start ${command}: ${error.message}`);
    stop(1);
  });
  child.on('exit', code => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
  return child;
}

console.log('BayReady mobile · simulated reservations and charging; separate read-only hardware diagnostics');
console.log('Starting the demo API on your local network for Expo Go.');
const backend = run(process.execPath, ['server.mjs'], {
  ...process.env,
  HOST: '0.0.0.0',
  PORT: apiPort,
});

let ready = false;
for (let attempt = 0; attempt < 30 && !stopping; attempt++) {
  if (backend.exitCode !== null) break;
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`, { signal: AbortSignal.timeout(500) });
    const health = await response.json();
    if (response.ok && health.healthy === true && health.mode === 'mock') {
      ready = true;
      break;
    }
  } catch {
    // Wait briefly for the owned server to start.
  }
  await delay(150);
}

if (!ready || stopping || backend.exitCode !== null) {
  if (!stopping) console.error(`The demo API could not start on port ${apiPort}. Stop another server or try PORT=3001 npm start.`);
  stop(1);
} else {
  for (const address of Object.values(networkInterfaces()).flat()) {
    if (address && address.family === 'IPv4' && !address.internal) {
      console.log(`Phone API address: http://${address.address}:${apiPort}`);
    }
  }
  console.log('Keep the phone and Mac on the same Wi-Fi. Scan the Expo QR code below.');
  console.log('Ctrl+C stops both Expo and the demo API.');
  run(process.execPath, [resolve(root, 'mobile/node_modules/expo/bin/cli'), 'start', '--go', '--lan', '--port', '8081', ...process.argv.slice(2)], {
    ...mobileEnvironment(process.env),
    EXPO_PUBLIC_API_PORT: apiPort,
  }, resolve(root, 'mobile'));
}
