import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
let failures = 0;
function report(ok, message) {
  console.log(`${ok ? 'OK' : 'CHECK'}  ${message}`);
  if (!ok) failures++;
}

report(Number(process.versions.node.split('.')[0]) >= 24, `Node ${process.versions.node}; use Node 24 or newer`);
for (const file of ['package.json', 'server.mjs', 'public/index.html', 'public/app.js', 'lib/ecurious-adapter.mjs', 'source/challenge-brief.pdf']) {
  report(existsSync(resolve(root, file)), file);
}
report(!process.env.ECURIOUS_MODE || process.env.ECURIOUS_MODE === 'mock', 'Starter uses mock hardware; live mode requires on-site implementation');

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  report(false, 'PORT must be an integer between 1 and 65535');
} else {
  await new Promise((resolveCheck) => {
    const probe = createServer();
    probe.once('error', (error) => {
      report(false, `Port ${port} probe: ${error.code}. Stop an existing server or try PORT=3001 npm start.`);
      resolveCheck();
    });
    probe.listen(port, '127.0.0.1', () => {
      report(true, `127.0.0.1:${port} is available`);
      probe.close(resolveCheck);
    });
  });
}

console.log('Backend check complete. For the mobile app, install mobile dependencies on a fresh checkout, then run npm start.');
process.exitCode = failures ? 1 : 0;
