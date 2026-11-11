import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CurrentMonthView, PreviousMonthView } from '@otus/shared/core/time-requirement';
import { TimeRequirementCard } from './time-requirement-card';

const HOUR = 3600;
const thresholds = [
  { seconds: 40 * HOUR, amount: 500000 },
  { seconds: 80 * HOUR, amount: 1000000 },
];
const current: CurrentMonthView = {
  month: '2026-10',
  asOf: '2026-10-17T14:00:00+09:00',
  recognizedSeconds: 52 * HOUR,
  thresholds,
  decidesAt: '2026-11-01T09:00:00+09:00',
};
const previous: PreviousMonthView = {
  month: '2026-09',
  recognizedSeconds: 31 * HOUR,
  thresholds,
  decidesAt: '2026-10-01T09:00:00+09:00',
  result: { status: 'not_met', amount: null },
  final: { status: 'undecided', amount: null },
};

describe('TimeRequirementCard', () => {
  let fixture: ComponentFixture<TimeRequirementCard>;
  let el: HTMLElement;

  function render(c: CurrentMonthView | null, p: PreviousMonthView | null): void {
    fixture = TestBed.createComponent(TimeRequirementCard);
    fixture.componentRef.setInput('current', c);
    fixture.componentRef.setInput('previous', p);
    fixture.detectChanges();
    el = fixture.nativeElement;
  }

  it('shows this month with the bar and last month with its result', () => {
    render(current, previous);
    const parts = el.querySelectorAll('.part');
    expect(parts.length).toBe(2);
    expect(parts[0].querySelector('.label')?.textContent).toContain('10월 17일 14:00 기준');
    expect(parts[0].querySelector('app-time-badge')?.textContent?.trim()).toBe('달성(예상)');
    expect(parts[0].querySelector('app-time-badge')?.getAttribute('data-tone')).toBe('projected');
    const bar = parts[0].querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe(String(52 * HOUR));
    expect(bar?.getAttribute('aria-valuemax')).toBe(String(80 * HOUR));
    expect(parts[1].querySelector('.label')?.textContent).toContain('지난달');
    expect(parts[1].querySelector('app-time-badge')?.textContent?.trim()).toBe('미충족');
    expect(el.querySelector('hr')).not.toBeNull();
  });

  it('renders either part alone', () => {
    render(null, previous);
    expect(el.querySelectorAll('.part').length).toBe(1);
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
    expect(el.querySelector('hr')).toBeNull();
  });

  it('keeps the bar full past the top threshold', () => {
    render({ ...current, recognizedSeconds: 95 * HOUR }, null);
    const bar = el.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe(String(80 * HOUR));
    expect(bar?.getAttribute('aria-valuetext')).toBe('95시간 인정');
  });
});
