import { CurrentMonthView } from '@otus/shared/core/time-requirement';
import { recipientStatus } from './recipient-status';

function view(recognizedSeconds: number, over: Partial<CurrentMonthView> = {}): CurrentMonthView {
  return {
    month: '2026-10',
    asOf: '2026-10-17T14:00:00+09:00',
    recognizedSeconds,
    thresholds: [
      { seconds: 144000, amount: 500000 },
      { seconds: 288000, amount: 1000000 },
    ],
    decidesAt: '2026-11-01T09:00:00+09:00',
    ...over,
  };
}

describe('recipientStatus (this month)', () => {
  it('is 대상 아님 (예상) below the first tier, and says how to get there', () => {
    for (const seconds of [0, 83400, 143999]) {
      const s = recipientStatus(view(seconds));
      expect(s.label).toBe('수령 대상 · 10월');
      expect(s.value).toBe('대상 아님 (예상)');
      expect(s.sub).toContain('40시간을 채우면 50만 원 구간 대상이 돼요');
    }
  });

  it('is 대상 (예상) from the first tier on, with the reached tier', () => {
    expect(recipientStatus(view(144000)).value).toBe('대상 (예상)');
    expect(recipientStatus(view(144000)).sub).toContain('50만 원 구간');
    expect(recipientStatus(view(309600)).sub).toContain('100만 원 구간');
  });

  it('only staff turn the estimate into a decision', () => {
    const eligible = recipientStatus(view(150000), { status: 'eligible', amount: 500000 });
    expect(eligible.value).toBe('대상 확정');
    expect(eligible.sub).toContain('50만 원');
    const no = recipientStatus(view(150000), { status: 'not_eligible', amount: null });
    expect(no.value).toBe('해당 없음');
    // undecided changes nothing
    expect(recipientStatus(view(150000), { status: 'undecided', amount: null }).value).toBe(
      '대상 (예상)',
    );
  });

  it('never says 확정 for the estimate', () => {
    const s = recipientStatus(view(300000));
    expect(`${s.value} ${s.sub}`).not.toContain('대상 확정');
  });

  it('takes hours and won from the thresholds, and never mentions last month', () => {
    const s = recipientStatus(view(3600, { thresholds: [{ seconds: 72000, amount: 200000 }] }));
    expect(s.sub).toContain('20시간을 채우면 20만 원 구간');
    expect(`${s.label} ${s.value} ${s.sub}`).not.toContain('지난달');
  });
});
