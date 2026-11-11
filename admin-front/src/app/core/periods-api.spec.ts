import { periodDefaults, periodInput, periodSave } from './periods-api';

describe('period inputs and KST boundaries', () => {
  it('uses KST independently of the browser timezone and preserves the inclusive last second', () => {
    expect(periodInput('2026-10-20T15:30:00Z')).toBe('2026-10-21T00:30:00');
    expect(periodInput('2026-11-01T00:00:00+09:00', 1000)).toBe('2026-10-31T23:59:59');
    expect(periodSave('2026-10', '2026-10-21T09:00', '2026-10-31T23:59:59', 3)).toEqual({
      opens_at: '2026-10-21T00:00:00.000Z',
      closes_at: '2026-10-31T15:00:00.000Z',
      expected_version: 3,
    });
  });

  it('handles December and leap February defaults', () => {
    expect(periodDefaults('2026-12')).toEqual({
      start: '2026-12-01T00:00:00',
      end: '2026-12-31T23:59:59',
    });
    expect(periodDefaults('2028-02').end).toBe('2028-02-29T23:59:59');
    expect(periodDefaults('2027-02').end).toBe('2027-02-28T23:59:59');
  });

  it('blocks missing, invalid, reversed and cross-month input', () => {
    for (const [start, end] of [
      ['', '2026-10-31T23:59:59'],
      ['2026-09-30T23:59:59', '2026-10-31T23:59:59'],
      ['2026-10-01T00:00', '2026-11-01T00:00'],
      ['2026-10-21T09:00', '2026-10-21T08:59'],
      ['2026-10-32T00:00', '2026-10-32T00:01'],
    ])
      expect(periodSave('2026-10', start, end, null)).toBeNull();
    expect(periodSave('2027-02', '2027-02-01T00:00', '2027-02-29T23:59', null)).toBeNull();
  });
});
