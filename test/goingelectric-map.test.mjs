import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMapUrl, GOINGELECTRIC_MAP_URL, isMainDocumentFailure } from '../mobile/src/lib/goingelectric-map.ts';

test('official map and station pages stay in the app while outbound links use the browser', () => {
  for (const url of [GOINGELECTRIC_MAP_URL, 'https://goingelectric.de/stromtankstellen/', 'https://cdn.goingelectric.de/stromtankstellen/', 'https://www.goingelectric.de/stromtankstellen/Deutschland/Muenchen/example/123/#details']) {
    assert.equal(classifyMapUrl(url), 'internal');
  }
  assert.equal(classifyMapUrl('about:blank'), 'internal');
  assert.equal(classifyMapUrl('https://maps.google.com/?q=Munich'), 'external');
  assert.equal(classifyMapUrl('https://www.goingelectric.de.example.com/map'), 'external');
  assert.equal(classifyMapUrl('https://www.goingelectric.de:444/map'), 'external');
});

test('document navigation rejects executable/local schemes and credential-bearing URLs', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'intent://example', 'data:text/html,test', 'not a URL', 'https://user:secret@www.goingelectric.de/', 'https://www.goingelectric.de@evil.example/']) {
    assert.equal(classifyMapUrl(url), 'blocked');
  }
});

test('only a main document HTTP failure should replace the map with an error', () => {
  assert.equal(isMainDocumentFailure(GOINGELECTRIC_MAP_URL, `${GOINGELECTRIC_MAP_URL}#zoom=12`), true);
  assert.equal(isMainDocumentFailure('https://tiles.example.com/tile.png', GOINGELECTRIC_MAP_URL), false);
  assert.equal(isMainDocumentFailure(`${GOINGELECTRIC_MAP_URL}image.png`, GOINGELECTRIC_MAP_URL), false);
  assert.equal(isMainDocumentFailure('invalid', GOINGELECTRIC_MAP_URL), false);
});
