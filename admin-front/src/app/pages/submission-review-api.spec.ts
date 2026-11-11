import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { DOC_TYPE_LABELS, DocType } from '@otus/shared/core/api-types';
import { AuthService } from '../core/auth.service';
import { ReviewNavigation, SubmissionDetail, SubmissionEvent } from '../core/review-api';
import { ReviewState } from '../core/review-state';
import { PdfSlot } from '../ui/pdf-slot';
import { PdfViewer } from '../ui/pdf-viewer';
import { ReviewStage, SubmissionReview } from './submission-review';

// PDF rendering has its own tests. These API flow tests must never fetch originals.
@Component({ selector: 'app-pdf-viewer', template: '' })
class PdfViewerStub {
  readonly fileId = input.required<string>();
}

const DETAIL: SubmissionDetail = {
  id: 'real-submission',
  kind: 'monthly',
  target_month: '2026-09',
  status: 'pending_review',
  parent_id: null,
  root_id: 'real-submission',
  latest_submission_id: 'real-submission',
  user: { id: 3, name: '실제 제출자', login: 'realstudent', employed: false },
  submitted_at: '2026-09-10T10:00:00+09:00',
  required_doc_types: ['employment_insurance'],
  review_comment: null,
  revision_doc_types: [],
  cycle: null,
  files: [
    {
      id: 'real-file',
      doc_type: 'employment_insurance',
      original_name: '실제서류.pdf',
      size_bytes: 100,
      uploaded_at: '2026-09-10T10:00:00+09:00',
    },
  ],
};

const INITIAL_DOCS: DocType[] = [
  'id_card',
  'resident_abstract',
  'bankbook',
  'employment_insurance',
];
const INITIAL_DETAIL: SubmissionDetail = {
  ...DETAIL,
  kind: 'initial',
  required_doc_types: INITIAL_DOCS,
  files: INITIAL_DOCS.map((doc_type) => ({
    id: `file-${doc_type}`,
    doc_type,
    original_name: `${DOC_TYPE_LABELS[doc_type]}.pdf`,
    size_bytes: 100,
    uploaded_at: DETAIL.submitted_at,
  })),
};

describe('live review decisions', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  beforeEach(() => {
    TestBed.overrideComponent(PdfSlot, {
      remove: { imports: [PdfViewer] },
      add: { imports: [PdfViewerStub] },
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(
          (['review', 'approve', 'approved', 'revision', 'requested'] as ReviewStage[]).map(
            (stage) => ({
              path:
                'submissions/:id' +
                (stage === 'review'
                  ? ''
                  : '/' + (stage === 'requested' ? 'revision/requested' : stage)),
              component: SubmissionReview,
              data: { stage },
            }),
          ),
        ),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).setMe({
      id: 2,
      login: 'reviewer',
      display_name: '담당자',
      role: 'operator',
      is_demo: true,
      study_hours: 0,
      employed: false,
      employment_updated_at: null,
      initial_submitted: false,
    });
  });
  afterEach(() => http.verify({ ignoreCancelled: true }));
  /** The study-hour aggregate of the submission's month (40 hours: requirement met) */
  function flushHours(userId = DETAIL.user.id, studyHours: 0 | 40 | 80 | null = 40) {
    http
      .expectOne((r) => r.url === '/api/admin/notices/submission-reminder')
      .flush({ targets: [{ user_id: userId, study_hours: studyHours }] });
  }
  function flushView(
    detail = DETAIL,
    events: SubmissionEvent[] = [],
    navigation: ReviewNavigation = { previous_id: null, next_id: null, remaining_count: 0 },
  ) {
    http.expectOne('/api/admin/submissions/' + detail.id).flush(detail);
    http
      .expectOne('/api/admin/submissions/' + detail.id + '/history')
      .flush({ root_id: detail.id, items: [detail] });
    http
      .expectOne('/api/admin/submissions/' + detail.id + '/events')
      .flush({ root_id: detail.id, items: events });
    http
      .expectOne('/api/admin/submissions/' + detail.id + '/navigation?month=' + detail.target_month)
      .flush(navigation);
    for (const id of [navigation.previous_id, navigation.next_id]) {
      if (id)
        http.expectOne('/api/admin/submissions/' + id).flush({ user: { id: detail.user.id + 1 } });
    }
    flushHours(detail.user.id);
    harness.detectChanges();
  }
  function button(text: string) {
    return [...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.includes(text),
    )!;
  }
  it('shows success only after the server saves; a failed retry keeps its idempotency key', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission/approve');
    flushView();
    expect(harness.routeNativeElement!.textContent).toContain('실제서류.pdf');
    http.expectNone((request) => request.method === 'POST');
    button('승인 확정하기').click();
    harness.detectChanges();
    const first = http.expectOne('/api/admin/submissions/real-submission/review');
    const key = first.request.headers.get('Idempotency-Key');
    expect(key).toBeTruthy();
    expect(first.request.body).toEqual({ status: 'approved' });
    expect(button('승인 확정하기').disabled).toBe(true);
    first.flush(
      { error: { code: 'INTERNAL_ERROR', message: '저장할 수 없습니다.' } },
      { status: 500, statusText: 'Error' },
    );
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/submissions/real-submission/approve');
    expect(harness.routeNativeElement!.textContent).toContain('저장할 수 없습니다.');
    button('승인 확정하기').click();
    const retry = http.expectOne('/api/admin/submissions/real-submission/review');
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush({
      id: DETAIL.id,
      status: 'approved',
      reviewed_by: { name: '담당자', role: 'operator' },
      reviewed_at: '2026-10-18T10:00:00+09:00',
    });
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toContain('/approved'));
    flushView({ ...DETAIL, status: 'approved' }, [
      {
        id: 9,
        submission_id: DETAIL.id,
        action: 'approved',
        actor: { name: '담당자', role: 'operator' },
        at: '2026-10-18T10:00:00+09:00',
        review_comment: null,
        revision_doc_types: [],
      },
    ]);
    expect(harness.routeNativeElement!.textContent).toContain('서류를 승인했어요');
  });
  it('a direct success URL cannot approve a pending submission', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission/approved');
    flushView();
    http.expectNone((request) => request.method === 'POST');
    expect(harness.routeNativeElement!.textContent).toContain('승인 완료된 제출이 아닙니다.');
    expect(harness.routeNativeElement!.textContent).not.toContain('서류를 승인했어요');
  });
  it('without a cycle, review stays readable and only approval is allowed', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission');
    flushView();
    expect(harness.routeNativeElement!.textContent).toContain('승인만 가능합니다');
    expect(button('보완 요청').disabled).toBe(true);
    expect(button('승인 검토').disabled).toBe(false);
  });

  it('rechecks the deadline on confirmation before the next timer tick and sends no revision POST', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T23:59:59+09:00'));
    try {
      harness = await RouterTestingHarness.create('/submissions/real-submission/revision');
      flushView({
        ...DETAIL,
        cycle: {
          opens_at: '2026-09-01T00:00:00+09:00',
          closes_at: '2026-10-01T00:00:00+09:00',
          issued_after: '2026-09-01',
        },
      });
      const reason = harness.routeNativeElement!.querySelector<HTMLTextAreaElement>('#reason')!;
      reason.value = '발급일이 보이는 서류를 다시 제출해 주세요.';
      reason.dispatchEvent(new Event('input'));
      harness.detectChanges();
      expect(button('보완 요청 확정').disabled).toBe(false);

      // No fake timers: an already enabled button is clicked immediately after
      // the clock crosses the exclusive close, before the UI timer can run.
      clock.mockReturnValue(Date.parse('2026-10-01T00:00:00+09:00'));
      button('보완 요청 확정').click();
      harness.detectChanges();
      http.expectNone((request) => request.method === 'POST');
      expect(button('보완 요청 확정').disabled).toBe(true);
      expect(harness.routeNativeElement!.textContent).toContain('승인만 가능합니다.');
      expect(TestBed.inject(Router).url).toBe('/submissions/real-submission/revision');
    } finally {
      clock.mockRestore();
    }
  });

  it('renders all required documents for a legacy revision with empty requested arrays', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission/revision/requested');
    flushView(
      {
        ...INITIAL_DETAIL,
        status: 'revision_requested',
        review_comment: '필수 서류를 다시 제출해 주세요.',
        revision_doc_types: [],
      },
      [
        {
          id: 10,
          submission_id: DETAIL.id,
          action: 'revision_requested',
          actor: { name: '담당자', role: 'operator' },
          at: '2026-09-10T11:00:00+09:00',
          review_comment: '필수 서류를 다시 제출해 주세요.',
          revision_doc_types: [],
        },
      ],
    );
    const result = harness.routeNativeElement!.querySelector('app-revision-requested-view')!;
    expect(result.textContent).toContain('보완 대상 서류 4개');
    const requestedNames = result.querySelectorAll('dd')[1].textContent ?? '';
    for (const type of INITIAL_DOCS) expect(requestedNames).toContain(DOC_TYPE_LABELS[type]);
    expect(result.textContent).not.toContain('보완 대상 서류 0개');
    http.expectNone((request) => request.method === 'POST');
  });

  it('keeps direct initial approval disabled until all four documents were viewed', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission/approve');
    flushView(INITIAL_DETAIL);
    const state = TestBed.inject(ReviewState);
    expect(state.viewed()).toEqual([]);
    expect(button('4종 모두 승인하기').disabled).toBe(true);
    button('4종 모두 승인하기').click();
    http.expectNone((request) => request.method === 'POST');

    for (const type of INITIAL_DOCS.slice(0, 3)) state.markViewed(type);
    harness.detectChanges();
    expect(button('4종 모두 승인하기').disabled).toBe(true);
    state.markViewed(INITIAL_DOCS[3]);
    harness.detectChanges();
    expect(button('4종 모두 승인하기').disabled).toBe(false);
    http.expectNone((request) => request.method === 'POST');

    button('4종 모두 승인하기').click();
    const request = http.expectOne('/api/admin/submissions/real-submission/review');
    expect(request.request.body).toEqual({ status: 'approved' });
    request.flush(
      { error: { code: 'INTERNAL_ERROR', message: '다시 시도해 주세요.' } },
      { status: 500, statusText: 'Error' },
    );
    harness.detectChanges();
  });

  it('moves to another user and back, preserving the month without carrying checked documents', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission?month=2026-09');
    flushView(INITIAL_DETAIL, [], {
      previous_id: null,
      next_id: 'next-submission',
      remaining_count: 1,
    });
    expect(button('이전 사용자').disabled).toBe(true);
    expect(button('다음 사용자').disabled).toBe(false);
    for (const type of INITIAL_DOCS) TestBed.inject(ReviewState).markViewed(type);
    button('다음 사용자').click();
    await vi.waitFor(() =>
      expect(TestBed.inject(Router).url).toBe('/submissions/next-submission?month=2026-09'),
    );
    const next = {
      ...DETAIL,
      id: 'next-submission',
      latest_submission_id: 'next-submission',
      user: { ...DETAIL.user, id: 4, name: '다음 교육생' },
    };
    flushView(next, [], { previous_id: DETAIL.id, next_id: null, remaining_count: 1 });
    expect(harness.routeNativeElement!.textContent).toContain('다음 교육생');
    expect(TestBed.inject(ReviewState).viewed()).not.toContain('bankbook');
    expect(button('다음 사용자').disabled).toBe(true);
    button('이전 사용자').click();
    await vi.waitFor(() =>
      expect(TestBed.inject(Router).url).toBe('/submissions/real-submission?month=2026-09'),
    );
    flushView(INITIAL_DETAIL);
    expect(harness.routeNativeElement!.textContent).toContain('실제 제출자');
    expect(button('4종 승인 검토').disabled).toBe(true);
  });

  it('keeps navigation in approval confirmation and disables it while saving', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission/approve');
    flushView(DETAIL, [], {
      previous_id: 'previous-submission',
      next_id: 'next-submission',
      remaining_count: 2,
    });
    expect(button('이전 사용자').disabled).toBe(false);
    expect(button('다음 사용자').disabled).toBe(false);
    button('승인 확정하기').click();
    harness.detectChanges();
    expect(button('이전 사용자').disabled).toBe(true);
    expect(button('다음 사용자').disabled).toBe(true);
    http
      .expectOne('/api/admin/submissions/real-submission/review')
      .flush(
        { error: { code: 'INTERNAL_ERROR', message: '다시 시도해 주세요.' } },
        { status: 500, statusText: 'Error' },
      );
    harness.detectChanges();
    expect(button('다음 사용자').disabled).toBe(false);
  });

  it('keeps the review readable when navigation cannot be loaded', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission/approve');
    http.expectOne('/api/admin/submissions/real-submission').flush(DETAIL);
    http
      .expectOne('/api/admin/submissions/real-submission/history')
      .flush({ root_id: DETAIL.id, items: [DETAIL] });
    http
      .expectOne('/api/admin/submissions/real-submission/events')
      .flush({ root_id: DETAIL.id, items: [] });
    http
      .expectOne('/api/admin/submissions/real-submission/navigation?month=2026-09')
      .flush({}, { status: 500, statusText: 'Error' });
    flushHours();
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('승인하기 전에');
    expect(harness.routeNativeElement!.textContent).toContain(
      '이전·다음 사용자를 불러오지 못했습니다',
    );
    expect(button('승인 확정하기').disabled).toBe(false);
    expect(button('이전 사용자').disabled).toBe(true);
    expect(button('다음 사용자').disabled).toBe(true);
  });
  it('shows the month hours and approves with no extra step when 40 hours are met', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission/approve');
    flushView();
    const text = harness.routeNativeElement!.textContent;
    expect(text).toContain('학습 시간 · 40시간 이상 80시간 미만');
    expect(harness.routeNativeElement!.querySelector('.override')).toBeNull();
    expect(button('승인 확정하기').disabled).toBe(false);
  });

  it('needs the reviewer to confirm when the hours are under 40 or unknown', async () => {
    harness = await RouterTestingHarness.create('/submissions/real-submission/approve');
    http.expectOne('/api/admin/submissions/real-submission').flush(DETAIL);
    http
      .expectOne('/api/admin/submissions/real-submission/history')
      .flush({ root_id: DETAIL.id, items: [DETAIL] });
    http
      .expectOne('/api/admin/submissions/real-submission/events')
      .flush({ root_id: DETAIL.id, items: [] });
    http
      .expectOne('/api/admin/submissions/real-submission/navigation?month=2026-09')
      .flush({ previous_id: null, next_id: null, remaining_count: 0 });
    flushHours(DETAIL.user.id, 0);
    harness.detectChanges();
    const root = harness.routeNativeElement!;
    expect(root.textContent).toContain('40시간 미만');
    expect(button('승인 확정하기').disabled).toBe(true);
    const box = root.querySelector<HTMLInputElement>('.override input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect(button('승인 확정하기').disabled).toBe(false);
  });
});
