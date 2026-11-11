import { monthLabel } from './labels';

describe('labels', () => {
  it('labels months', () => {
    expect(monthLabel('2026-09')).toBe('2026년 9월');
    expect(monthLabel('2026-10')).toBe('2026년 10월');
  });
});
