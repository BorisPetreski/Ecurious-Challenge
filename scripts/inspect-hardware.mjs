import { EcuriousAdapter, EcuriousApiError } from '../lib/ecurious-adapter.mjs';

try {
  const adapter = new EcuriousAdapter({ apiKey: process.env.ECURIOUS_API_KEY, baseUrl: process.env.ECURIOUS_BASE_URL });
  console.log(JSON.stringify(await adapter.listLocks(), null, 2));
  if (!adapter.configured) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof EcuriousApiError ? `${error.code}: ${error.message}` : 'Could not inspect Ecurious hardware.');
  process.exitCode = 1;
}
