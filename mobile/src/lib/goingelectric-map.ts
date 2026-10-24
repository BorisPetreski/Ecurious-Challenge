export const GOINGELECTRIC_MAP_URL = 'https://www.goingelectric.de/stromtankstellen/';

const directoryHosts = new Set(['goingelectric.de', 'www.goingelectric.de', 'cdn.goingelectric.de']);

/** Classifies document navigation only; the website loads its own map resources. */
export function classifyMapUrl(value: string): 'internal' | 'external' | 'blocked' {
  if (value === 'about:blank') return 'internal';
  try {
    const url = new URL(value);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return 'blocked';
    if (url.protocol === 'https:' && directoryHosts.has(url.hostname) && (!url.port || url.port === '443')) return 'internal';
    return 'external';
  } catch {
    return 'blocked';
  }
}

/** A failed tile, advert, or other subresource must not hide a working map. */
export function isMainDocumentFailure(failedUrl: string, documentUrl: string): boolean {
  try {
    const failed = new URL(failedUrl);
    const document = new URL(documentUrl);
    failed.hash = '';
    document.hash = '';
    return failed.href === document.href;
  } catch {
    return false;
  }
}
