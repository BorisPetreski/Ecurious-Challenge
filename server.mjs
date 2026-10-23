import { createServer as createHttpServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimulator, DomainError } from './lib/simulator.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 8 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Send a JSON object with Content-Type: application/json.', 415);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new DomainError('BODY_TOO_LARGE', 'JSON bodies are limited to 8 KiB.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('INVALID_JSON', 'The request body must be valid JSON.', 400);
  }
}

function isWithin(root, target) {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith('../') && !isAbsolute(path);
}

/** Exported for an HTTP smoke test without binding a production port. */
export function createServer({ simulator = createSimulator(), publicDir = resolve(ROOT, 'public') } = {}) {
  return createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.goingelectric.de; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      // A fixed base avoids trusting the Host header for route parsing.
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/health') {
          json(response, 200, { healthy: true, mode: 'mock' });
        } else if (request.method === 'GET' && url.pathname === '/api/state') {
          json(response, 200, simulator.getState());
        } else if (request.method === 'POST' && url.pathname === '/api/reservations') {
          json(response, 201, simulator.reserve(await readJson(request)));
        } else if (request.method === 'POST' && url.pathname === '/api/actions') {
          json(response, 200, simulator.action(await readJson(request)));
        } else if (['/api/state', '/api/health', '/api/reservations', '/api/actions'].includes(url.pathname)) {
          const allow = ['/api/state', '/api/health'].includes(url.pathname) ? 'GET' : 'POST';
          json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'This route does not support that method.' } }, { Allow: allow });
        } else {
          json(response, 404, { error: { code: 'NOT_FOUND', message: 'API route not found.' } });
        }
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Static files support GET and HEAD.' } }, { Allow: 'GET, HEAD' });
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        throw new DomainError('INVALID_PATH', 'The request path is invalid.', 400);
      }
      if (pathname.includes('\0') || pathname.includes('\\')) {
        throw new DomainError('INVALID_PATH', 'The request path is invalid.', 400);
      }
      const target = resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!isWithin(publicDir, target)) throw new DomainError('NOT_FOUND', 'File not found.', 404);
      try {
        const [actualRoot, actualTarget] = await Promise.all([realpath(publicDir), realpath(target)]);
        if (!isWithin(actualRoot, actualTarget) || !(await stat(actualTarget)).isFile()) {
          throw new DomainError('NOT_FOUND', 'File not found.', 404);
        }
        const content = await readFile(actualTarget);
        response.writeHead(200, {
          'Content-Type': MIME[extname(actualTarget).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': content.length,
          'Cache-Control': 'no-store',
        });
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
          throw new DomainError('NOT_FOUND', 'File not found.', 404);
        }
        throw error;
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof DomainError) {
        json(response, error.status, { error: { code: error.code, message: error.message } });
      } else {
        // Do not log request bodies, scanned plates or third-party error payloads.
        json(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'The local simulator could not process this request.' } });
      }
    }
  });
}

export function start({ env = process.env } = {}) {
  const mode = (env.ECURIOUS_MODE ?? 'mock').trim().toLowerCase();
  if (mode !== 'mock') {
    throw new Error('Only ECURIOUS_MODE=mock is implemented. Live mode requires the documented Ecurious adapter, authenticated status feed and sensor interlock.');
  }
  const rawPort = env.PORT ?? '3000';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('PORT must be a whole number from 1 to 65535.');
  }
  const server = createServer();
  server.listen(Number(rawPort), '127.0.0.1', () => {
    console.log(`Ecurious local simulator: http://127.0.0.1:${rawPort} (mock only; no live hardware connected)`);
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${rawPort} is in use. Choose another PORT in .env.` : 'The local simulator could not start.');
    process.exitCode = 1;
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    start();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
