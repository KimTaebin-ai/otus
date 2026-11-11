import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Cycle, Submission } from '../core/api.models';
import { History } from './history';

function item(id: string, kind: Submission['kind'], month: string): Submission {
  return {
    id,
    kind,
    target_month: month,
    status: 'pending_review',
    parent_id: null,
    submitted_at: `${month}-21T09:41:00+09:00`,
    review_comment: null,
    required_doc_types: ['employment_insurance'],
    files: [
      {
        file_id: `f-${id}`,
        doc_type: 'employment_insurance',
        original_name: `${id}.pdf`,
        size: 183204,
        uploaded_at: `${month}-21T09:40:00+09:00`,
      },
    ],
    created_at: `${month}-21T09:30:00+09:00`,
  };
}

function cycle(state: Cycle['state'], month = '2026-10'): Cycle {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return {
    target_month: month,
    state,
    opens_at: `${month}-01T00:00:00+09:00`,
    closes_at: `${next}-01T00:00:00+09:00`,
    d_day: 10,
    issued_after: `${month}-01`,
  };
}

describe('History (U05)', () => {
  function flush(
    http: HttpTestingController,
    items: Submission[],
    c: Cycle | null = cycle('closed'),
  ) {
    http.expectOne('/api/submissions').flush({ items });
    const req = http.expectOne('/api/cycles/current');
    if (c) {
      req.flush(c);
    } else {
      req.flush({}, { status: 500, statusText: 'x' });
    }
  }

  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(History);
    fixture.detectChanges();
    return { http, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the newest submission on top and groups by month, newest first', async () => {
    const { http, fixture, el } = setup();
    const big = item('b', 'monthly', '2026-10');
    big.files = [{ ...big.files[0], size: 1.2 * 1024 * 1024 }];
    flush(http, [big, item('a', 'initial', '2026-09')]);
    await fixture.whenStable();

    expect(el.querySelector('app-info-box')?.textContent).toContain(
      '월별 서류 1종을 제출했어요 · 검토 중',
    );
    expect(el.querySelector('app-info-box')?.textContent).toContain('2026.10.21 09:41 접수');
    const titles = [...el.querySelectorAll('app-card h2')].map((h) => h.textContent?.trim());
    expect(titles).toEqual([
      '2026년 10월 · 월별 제출 서류',
      '접수 정보',
      '2026년 9월 · 최초 제출 서류',
      '접수 정보',
    ]);
    const metas = [...el.querySelectorAll('app-upload-slot .meta')].map((m) =>
      m.textContent?.trim(),
    );
    expect(metas).toEqual(['b.pdf · 1.2 MB', 'a.pdf · 179 KB']);
    const labels = [...el.querySelectorAll('app-upload-slot button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['미리보기', '미리보기']);
    expect(el.querySelector('app-upload-slot .row.done')).toBeNull();
    http.verify();
  });

  it('shows one line when there is no submission', async () => {
    const { http, fixture, el } = setup();
    flush(http, []);
    await fixture.whenStable();
    expect(el.querySelector('.empty')?.textContent?.trim()).toBe('아직 제출한 서류가 없어요.');
    expect(el.querySelector('app-info-box')).toBeNull();
    http.verify();
  });

  it('badges each card with the month latest status and links 보완 only for the open month', async () => {
    const { http, fixture, el } = setup();
    const monthly = { ...item('m', 'monthly', '2026-10'), status: 'revision_requested' as const };
    const initial = { ...item('i', 'initial', '2026-10'), status: 'approved' as const };
    flush(http, [monthly, initial], cycle('open'));
    await fixture.whenStable();

    const badges = [...el.querySelectorAll('app-status-badge')].map((b) => b.textContent?.trim());
    expect(badges).toEqual(['재검토 요청', '서류 승인']);
    expect(el.querySelector('.actions a')?.getAttribute('href')).toBe('/submit');
    expect(el.querySelector('app-info-box')?.textContent).toContain('‘보완 제출하기’');
    expect(el.textContent).not.toContain('미제출');
    http.verify();
  });

  it('puts a submission that needs 보완 in the top box even when it is not the newest', async () => {
    const { http, fixture, el } = setup();
    const initial = { ...item('i', 'initial', '2026-09'), status: 'approved' as const };
    const monthly = { ...item('m', 'monthly', '2026-10'), status: 'revision_requested' as const };
    flush(http, [initial, monthly], cycle('open'));
    await fixture.whenStable();
    expect(el.querySelector('app-info-box')?.textContent).toContain(
      '월별 서류 1종을 제출했어요 · 재검토 요청',
    );
    http.verify();
  });

  it('shows the monthly card as 재검토 대기 once the supplement is resubmitted', async () => {
    const { http, fixture, el } = setup();
    const monthly = { ...item('m', 'monthly', '2026-10'), status: 'resubmitted' as const };
    const sup = {
      ...item('s', 'supplement', '2026-10'),
      status: 'resubmitted' as const,
      parent_id: 'm',
    };
    flush(http, [sup, monthly], cycle('open'));
    await fixture.whenStable();
    const badges = [...el.querySelectorAll('app-status-badge')].map((b) => b.textContent?.trim());
    expect(badges).toEqual(['재검토 대기', '재검토 대기']);
    expect(el.querySelector('.actions a')).toBeNull();
    http.verify();
  });

  it('shows no 보완 link for a month other than the period', async () => {
    const { http, fixture, el } = setup();
    const monthly = { ...item('m', 'monthly', '2026-09'), status: 'revision_requested' as const };
    flush(http, [monthly], cycle('closed'));
    await fixture.whenStable();
    expect(el.querySelector('.actions a')).toBeNull();
    expect(el.querySelector('app-info-box')?.textContent).not.toContain('‘보완 제출하기’');
    http.verify();
  });

  it('adds a 미제출 card with a 제출하기 link while the period is open and has no monthly', async () => {
    const { http, fixture, el } = setup();
    flush(http, [item('a', 'initial', '2026-09')], cycle('open'));
    await fixture.whenStable();
    const first = el.querySelector('app-card') as HTMLElement;
    expect(first.querySelector('h2')?.textContent?.trim()).toBe('2026년 10월 · 월별 제출 서류');
    expect(first.querySelector('app-status-badge')?.textContent?.trim()).toBe('미제출');
    expect(first.querySelector('a')?.getAttribute('href')).toBe('/submit');
    http.verify();
  });

  it('shows no 미제출 card when this month was submitted as the 최초 4종', async () => {
    const { http, fixture, el } = setup();
    flush(http, [item('a', 'initial', '2026-10')], cycle('open'));
    await fixture.whenStable();
    expect(el.textContent).not.toContain('월별 제출 서류');
    expect(el.textContent).not.toContain('미제출');
    http.verify();
  });

  it('still lists submissions when the period request fails', async () => {
    const { http, fixture, el } = setup();
    flush(http, [item('a', 'initial', '2026-09')], null);
    await fixture.whenStable();
    expect(el.querySelectorAll('app-upload-slot').length).toBe(1);
    expect(el.textContent).not.toContain('미제출');
    http.verify();
  });
});
