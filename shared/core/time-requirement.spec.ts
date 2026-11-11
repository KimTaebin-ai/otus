import { hoursText, wonText } from './format';
import {
  CurrentMonthView,
  NO_BREAK,
  PreviousMonthView,
  TimeThreshold,
  currentCopy,
  previousCopy,
} from './time-requirement';

const HOUR = 3600;
const THRESHOLDS: TimeThreshold[] = [
  { seconds: 40 * HOUR, amount: 500000 },
  { seconds: 80 * HOUR, amount: 1000000 },
];

function now(recognizedSeconds: number): CurrentMonthView {
  return {
    month: '2026-10',
    asOf: '2026-10-17T14:00:00+09:00',
    recognizedSeconds,
    thresholds: THRESHOLDS,
    decidesAt: '2026-11-01T09:00:00+09:00',
  };
}

function last(
  result: PreviousMonthView['result'],
  final: PreviousMonthView['final'] = { status: 'undecided', amount: null },
  recognizedSeconds = 52 * HOUR,
): PreviousMonthView {
  return {
    month: '2026-09',
    recognizedSeconds,
    thresholds: THRESHOLDS,
    decidesAt: '2026-10-01T09:00:00+09:00',
    result,
    final,
  };
}

const allText = (c: { badge: string; title: string; lines: string[] }) =>
  [c.badge, c.title, ...c.lines].join(' ');

describe('hoursText / wonText', () => {
  it('cuts seconds down, never rounding up to the next minute or hour', () => {
    expect(hoursText(0)).toBe('0시간');
    expect(hoursText(59)).toBe('0시간');
    expect(hoursText(40 * HOUR - 1)).toBe('39시간 59분');
    expect(hoursText(40 * HOUR)).toBe('40시간');
    expect(hoursText(23 * HOUR + 10 * 60 + 59)).toBe('23시간 10분');
  });

  it('writes won amounts', () => {
    expect(wonText(500000)).toBe('50만 원');
    expect(wonText(1000000)).toBe('100만 원');
    expect(wonText(12345)).toBe('12,345원');
  });
});

describe('currentCopy (월중)', () => {
  it('says no time yet for a month without records', () => {
    const c = currentCopy(now(0));
    expect(c.state).toBe('no_record');
    expect(c.badge).toBe('집계 중');
    expect(c.title).toBe('아직 시간을 채우지 못했어요');
    expect(c.lines[0]).toBe(`50만 원 구간${NO_BREAK}(40시간)${NO_BREAK}까지 40시간 남았어요`);
  });

  it('switches to 달성(예상) exactly at 40 and 80 hours', () => {
    expect(currentCopy(now(40 * HOUR - 1)).state).toBe('below');
    expect(currentCopy(now(40 * HOUR - 1)).lines[0]).toBe(
      `50만 원 구간${NO_BREAK}(40시간)${NO_BREAK}까지 1분 미만 남았어요`,
    );
    const forty = currentCopy(now(40 * HOUR));
    expect(forty.state).toBe('projected');
    expect(forty.badge).toBe('달성(예상)');
    expect(forty.title).toBe('50만 원 구간 시간을 채웠어요');
    expect(currentCopy(now(80 * HOUR - 1)).title).toBe('50만 원 구간 시간을 채웠어요');
    expect(currentCopy(now(80 * HOUR)).title).toBe('100만 원 구간 시간을 채웠어요');
  });

  it('shows the server decision time as given, without computing it', () => {
    const c = currentCopy({ ...now(10 * HOUR), decidesAt: '2026-11-02T10:30:00+09:00' });
    expect(c.lines).toContain('11월 2일 10:30에 시간 요건을 판정해요.');
  });

  it('never reads as decided or as receiving the subsidy', () => {
    for (const s of [0, 10 * HOUR, 52 * HOUR, 86 * HOUR]) {
      const text = allText(currentCopy(now(s)));
      expect(text).not.toMatch(/확정|받아요|받을 수|지급/);
    }
  });
});

describe('previousCopy (지난달)', () => {
  it('waits for the decision with the server time', () => {
    const c = previousCopy(last(null));
    expect(c.state).toBe('awaiting_decision');
    expect(c.badge).toBe('판정 대기');
    expect(c.title).toBe('9월 시간 요건을 판정하고 있어요');
    expect(c.lines).toEqual(['10월 1일 09:00에 결과가 나와요.']);
  });

  it('shows met with the tier, leaving 수령 to staff', () => {
    const c = previousCopy(last({ status: 'met', amount: 500000 }));
    expect(c.title).toBe('9월 · 50만 원 구간');
    expect(c.lines).toContain('수령 대상은 서류 승인 후 운영팀이 확정해요.');
    expect(allText(c)).not.toMatch(/확정됐|받아요|지급/);
  });

  it('shows not_met with the hours against the first threshold', () => {
    const c = previousCopy(
      last({ status: 'not_met', amount: null }, undefined, 31 * HOUR + 20 * 60),
    );
    expect(c.badge).toBe('미충족');
    expect(c.lines).toEqual(['인정 31시간 20분 · 기준 40시간']);
  });

  it('shows on_hold', () => {
    expect(previousCopy(last({ status: 'on_hold', amount: null })).badge).toBe('판단 보류');
  });

  it('lets final win once staff decided', () => {
    const eligible = previousCopy(
      last({ status: 'met', amount: 1000000 }, { status: 'eligible', amount: 1000000 }),
    );
    expect(eligible.state).toBe('eligible');
    expect(eligible.title).toBe('9월 수령 대상으로 확정됐어요');
    expect(eligible.lines).toEqual(['100만 원 · 지급 일정은 따로 안내해드릴게요.']);

    const ineligible = previousCopy(
      last({ status: 'met', amount: 500000 }, { status: 'not_eligible', amount: null }),
    );
    expect(ineligible.state).toBe('not_eligible');
    expect(ineligible.title).toBe('9월은 수령 대상이 아니에요');
    expect(ineligible.lines).toEqual(['운영팀 확인 결과예요. 궁금한 점은 운영팀에 문의해주세요.']);

    // on_hold settled by staff also follows final
    expect(
      previousCopy(
        last({ status: 'on_hold', amount: null }, { status: 'not_eligible', amount: null }),
      ).state,
    ).toBe('not_eligible');
  });

  it('keeps not_met when final is not_eligible, since the hours already say why', () => {
    const c = previousCopy(
      last({ status: 'not_met', amount: null }, { status: 'not_eligible', amount: null }),
    );
    expect(c.state).toBe('not_met');
  });
});
