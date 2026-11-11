import { currentCopy, previousCopy } from '@otus/shared/core/time-requirement';
import { TimeRequirement } from './api.models';
import { toTimeRequirementViews } from './time-requirement-view';

const THRESHOLDS: TimeRequirement['thresholds'] = [
  { tier: 'tier_1', seconds: 144000, amount: 500000 },
  { tier: 'tier_2', seconds: 288000, amount: 1000000 },
];

function item(over: Partial<TimeRequirement>): TimeRequirement {
  return {
    month: '2026-10',
    phase: 'in_progress',
    as_of: '2026-10-17T14:00:00+09:00',
    recognized_seconds: 189000,
    thresholds: THRESHOLDS,
    projected_tier: 'tier_1',
    decides_at: '2026-11-01T09:00:00+09:00',
    result: null,
    final: { status: 'undecided', amount: null, decided_at: null },
    ...over,
  };
}

function previousItem(over: Partial<TimeRequirement>): TimeRequirement {
  return item({
    month: '2026-09',
    phase: 'decided',
    recognized_seconds: 150000,
    projected_tier: null,
    decides_at: '2026-10-01T09:00:00+09:00',
    result: { status: 'met', tier: 'tier_1', decided_at: '2026-10-01T09:00:12+09:00' },
    ...over,
  });
}

describe('toTimeRequirementViews', () => {
  it('maps the in-progress month to the current view', () => {
    const { current, previous } = toTimeRequirementViews([item({})]);
    expect(current).toEqual({
      month: '2026-10',
      asOf: '2026-10-17T14:00:00+09:00',
      recognizedSeconds: 189000,
      thresholds: [
        { seconds: 144000, amount: 500000 },
        { seconds: 288000, amount: 1000000 },
      ],
      decidesAt: '2026-11-01T09:00:00+09:00',
    });
    expect(previous).toBeNull();
  });

  it('keeps a month with no record (0 seconds) as the current month', () => {
    const { current } = toTimeRequirementViews([
      item({ recognized_seconds: 0, projected_tier: null }),
    ]);
    expect(current?.recognizedSeconds).toBe(0);
    expect(currentCopy(current!).state).toBe('no_record');
  });

  it('takes the previous month from the newest month that is no longer in progress', () => {
    const { current, previous } = toTimeRequirementViews([
      item({}),
      previousItem({}),
      previousItem({ month: '2026-08' }),
    ]);
    expect(current?.month).toBe('2026-10');
    expect(previous?.month).toBe('2026-09');
  });

  it('shows a month waiting for the decision as 판정 대기 with the server decides_at', () => {
    const { previous } = toTimeRequirementViews([
      item({ month: '2026-11', decides_at: '2026-12-01T09:00:00+09:00' }),
      previousItem({
        phase: 'awaiting_decision',
        result: null,
        decides_at: '2026-10-01T10:30:00+09:00',
      }),
    ]);
    expect(previous?.result).toBeNull();
    expect(previous?.decidesAt).toBe('2026-10-01T10:30:00+09:00');
    const copy = previousCopy(previous!);
    expect(copy.state).toBe('awaiting_decision');
    expect(copy.lines.join(' ')).toContain('10:30');
  });

  it("reads the amount of a met tier from that month's thresholds", () => {
    const { previous } = toTimeRequirementViews([
      previousItem({
        result: { status: 'met', tier: 'tier_2', decided_at: '2026-10-01T09:00:12+09:00' },
      }),
    ]);
    expect(previous?.result).toEqual({ status: 'met', amount: 1000000 });
  });

  it('has no amount for not_met and on_hold', () => {
    for (const status of ['not_met', 'on_hold'] as const) {
      const { previous } = toTimeRequirementViews([
        previousItem({ result: { status, tier: null, decided_at: '2026-10-01T09:00:12+09:00' } }),
      ]);
      expect(previous?.result).toEqual({ status, amount: null });
    }
  });

  it('carries the final decision, which wins in the copy', () => {
    const { previous } = toTimeRequirementViews([
      previousItem({
        final: { status: 'eligible', amount: 500000, decided_at: '2026-10-02T09:00:00+09:00' },
      }),
    ]);
    expect(previous?.final).toEqual({ status: 'eligible', amount: 500000 });
    expect(previousCopy(previous!).state).toBe('eligible');
  });

  it('uses only the response thresholds: no 40/80 hours or 50/100만 원 in the code path', () => {
    const policy: TimeRequirement['thresholds'] = [
      { tier: 'tier_1', seconds: 72000, amount: 200000 },
      { tier: 'tier_2', seconds: 144000, amount: 300000 },
    ];
    const { current, previous } = toTimeRequirementViews([
      item({ thresholds: policy, recognized_seconds: 36000 }),
      previousItem({
        thresholds: policy,
        result: { status: 'met', tier: 'tier_2', decided_at: '2026-10-01T09:00:12+09:00' },
      }),
    ]);
    const text = [
      ...currentCopy(current!).lines,
      ...previousCopy(previous!).lines,
      previousCopy(previous!).title,
    ].join(' ');
    expect(text).toContain('20만 원');
    expect(text).toContain('20시간');
    expect(text).toContain('30만 원');
    expect(text).not.toContain('50만 원');
    expect(text).not.toContain('40시간');
  });

  it('returns nothing for an empty list', () => {
    expect(toTimeRequirementViews([])).toEqual({ current: null, previous: null, currentFinal: null });
  });
});
