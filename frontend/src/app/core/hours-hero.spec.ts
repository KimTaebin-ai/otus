import { TimeRequirement } from './api.models';
import { expectedPayoutText, hoursHeroCopy } from './hours-hero';

describe('hoursHeroCopy', () => {
  it('shows only the current qualification band from the server', () => {
    expect(hoursHeroCopy(0)?.headline).toBe('40시간 미만 (예상)');
    expect(hoursHeroCopy(40)?.headline).toBe('40시간 이상 (예상)');
    expect(hoursHeroCopy(80)?.headline).toBe('80시간 이상 (예상)');
  });

  it('does not treat an unavailable lookup as below 40 hours', () => {
    expect(hoursHeroCopy(null)).toBeNull();
  });
});

describe('expectedPayoutText', () => {
  const item = (month: string, projected_tier: 'tier_1' | 'tier_2' | null): TimeRequirement => ({
    month,
    phase: 'in_progress',
    as_of: '2026-10-17T14:00:00+09:00',
    recognized_seconds: 189000,
    thresholds: [
      { tier: 'tier_1', seconds: 144000, amount: 500000 },
      { tier: 'tier_2', seconds: 288000, amount: 1000000 },
    ],
    projected_tier,
    decides_at: '2026-11-01T09:00:00+09:00',
    result: null,
    final: { status: 'undecided', amount: null, decided_at: null },
  });

  it('names the next month and the amount of the tier reached', () => {
    expect(expectedPayoutText(item('2026-10', 'tier_1'))).toBe(
      '다음달(11월) 예상 수령 금액 50만 원',
    );
    expect(expectedPayoutText(item('2026-10', 'tier_2'))).toContain('100만 원');
  });

  it('is 0원 below the first tier and rolls December over to January', () => {
    expect(expectedPayoutText(item('2026-12', null))).toBe('다음달(1월) 예상 수령 금액 0원');
  });
});
