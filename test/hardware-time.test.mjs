import test from 'node:test';
import assert from 'node:assert/strict';
import { berlinTimeChoices, berlinTimeFields, formatHardwareInstant, validateHardwareWindow } from '../mobile/src/lib/hardware-time.ts';

const now = Date.parse('2026-10-24T12:00:00.000Z');

test('Berlin fields resolve to UTC in summer and winter without device timezone assumptions', () => {
  assert.deepEqual(berlinTimeChoices('2026-10-24', '12:00'), [{ iso: '2026-10-24T10:00:00.000Z', offset: 'UTC+02:00' }]);
  assert.deepEqual(berlinTimeChoices('2026-10-26', '12:00'), [{ iso: '2026-10-26T11:00:00.000Z', offset: 'UTC+01:00' }]);
  assert.deepEqual(berlinTimeFields('2026-10-24T10:00:00Z'), { date: '2026-10-24', time: '12:00' });
});

test('the repeated autumn hour offers both explicit offsets rather than guessing', () => {
  const choices = berlinTimeChoices('2026-10-25', '02:30');
  assert.deepEqual(choices, [{ iso: '2026-10-25T00:30:00.000Z', offset: 'UTC+02:00' }, { iso: '2026-10-25T01:30:00.000Z', offset: 'UTC+01:00' }]);
  assert.match(formatHardwareInstant(choices[0].iso), /GMT\+2/);
  assert.match(formatHardwareInstant(choices[1].iso), /GMT\+1/);
  assert.equal(validateHardwareWindow(choices[0].iso, choices[1].iso, now), null);
});

test('nonexistent spring times and invalid calendar dates do not silently normalize', () => {
  assert.deepEqual(berlinTimeChoices('2026-03-29', '02:30'), []);
  assert.deepEqual(berlinTimeChoices('2026-02-30', '12:00'), []);
  assert.deepEqual(berlinTimeChoices('2026-10-24', '24:00'), []);
  assert.deepEqual(berlinTimeChoices('24/10/2026', '12:00'), []);
});

test('scheduled window bounds use real UTC duration, the agreed Now tolerance, and a 7-day horizon', () => {
  const iso = value => new Date(value).toISOString();
  assert.equal(validateHardwareWindow(iso(now), iso(now + 5 * 60_000), now), null);
  assert.equal(validateHardwareWindow(iso(now), iso(now + 120 * 60_000), now), null);
  assert.match(validateHardwareWindow(iso(now), iso(now + 4 * 60_000), now), /between/);
  assert.match(validateHardwareWindow(iso(now), iso(now + 121 * 60_000), now), /between/);
  assert.equal(validateHardwareWindow(iso(now - 60_000), iso(now + 9 * 60_000), now), null);
  assert.match(validateHardwareWindow(iso(now - 60_001), iso(now + 9 * 60_000), now), /passed/);
  const horizon = now + 7 * 86_400_000;
  assert.equal(validateHardwareWindow(iso(horizon), iso(horizon + 30 * 60_000), now), null);
  assert.match(validateHardwareWindow(iso(horizon + 1), iso(horizon + 30 * 60_000), now), /7 days/);
});
