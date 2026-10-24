import { start } from '../server.mjs';

try {
  process.loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

try {
  start({ env: { ...process.env, ...(process.argv.includes('--lan') ? { HOST: '0.0.0.0' } : {}) } });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
