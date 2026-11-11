import {
  hoursBand,
  hoursCheck,
  hoursMonthFor,
  needsHoursConfirm,
  reviewWindow,
  submissionTiming,
  workingMonthOf,
} from './study-hours';

describe('study hours check', () => {
  it('is met from 40 hours and needs no confirmation', () => {
    for (const h of [40, 80] as const) {
      const c = hoursCheck('2026-09', h);
      expect(c.state).toBe('met');
      expect(needsHoursConfirm(c)).toBe(false);
    }
    expect(hoursCheck('2026-09', 80).headline).toBe('2026년 9월 학습 시간 · 80시간 이상');
  });

  it('needs a confirmation when under 40 hours or unknown', () => {
    expect(needsHoursConfirm(hoursCheck('2026-09', 0))).toBe(true);
    expect(hoursCheck('2026-09', null).state).toBe('unknown');
    expect(needsHoursConfirm(hoursCheck('2026-09', undefined))).toBe(true);
  });
});

describe('hours month', () => {
  it('is the month before the one the staff are working in', () => {
    expect(hoursMonthFor('2026-10')).toBe('2026-09');
    expect(hoursMonthFor('2026-11')).toBe('2026-10');
    expect(hoursMonthFor('2026-01')).toBe('2025-12');
  });
  it('colours the bands apart', () => {
    expect(hoursBand(0).tone).toBe('low');
    expect(hoursBand(40).tone).toBe('mid');
    expect(hoursBand(80).tone).toBe('high');
    expect(hoursBand(null).tone).toBe('unknown');
  });
});

describe('review window', () => {
  it('reviews September 1st to October 15th when working in October', () => {
    const w = reviewWindow('2026-10');
    expect(w.title).toBe('9월 학습에 대한 지원금 지급 건 검토');
    expect(w.range).toBe('9월 1일 ~ 10월 15일 제출분');
  });
  it('reviews October 1st to November 15th when working in November', () => {
    expect(reviewWindow('2026-11').range).toBe('10월 1일 ~ 11월 15일 제출분');
  });
  it('rolls January back to December', () => {
    expect(reviewWindow('2027-01').range).toBe('12월 1일 ~ 1월 15일 제출분');
  });
});

describe('submission timing', () => {
  const w = reviewWindow('2026-10');
  it('splits submissions before, inside and after the review window', () => {
    expect(submissionTiming('2026-08-31T23:59:59+09:00', w)).toBe('early');
    expect(submissionTiming('2026-09-01T00:00:00+09:00', w)).toBe('in');
    expect(submissionTiming('2026-10-15T23:59:59+09:00', w)).toBe('in');
    expect(submissionTiming('2026-10-16T00:00:00+09:00', w)).toBe('late');
  });
});

describe('working month of a submission', () => {
  it('judges up to the 15th in that month and the rest in the next', () => {
    expect(workingMonthOf('2026-10-15T23:59:00+09:00')).toBe('2026-10');
    expect(workingMonthOf('2026-10-17T10:00:00+09:00')).toBe('2026-11');
    expect(workingMonthOf('2026-10-18T10:00:00+09:00')).toBe('2026-11');
    expect(workingMonthOf('2026-12-20T10:00:00+09:00')).toBe('2027-01');
  });
});
