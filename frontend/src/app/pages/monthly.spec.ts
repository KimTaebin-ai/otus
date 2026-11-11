import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  Cycle,
  IDEMPOTENCY_HEADER,
  Submission,
  SubmissionFile,
  SubmissionKind,
  SubmissionStatus,
} from '../core/api.models';
import { AuthService } from '../core/auth.service';
import { Monthly, monthlyOutcome } from './monthly';
import { Supplement } from './supplement';

/** GET /api/cycles/current (api.md) */
const cycle: Cycle = {
  target_month: '2026-10',
  state: 'open',
  opens_at: '2026-10-01T00:00:00+09:00',
  closes_at: '2026-11-01T00:00:00+09:00',
  d_day: 15,
  issued_after: '2026-10-01',
};

@Component({ template: '' })
class Stub {}

const upload: SubmissionFile = {
  file_id: 'f-1',
  doc_type: 'employment_insurance',
  original_name: '고용보험_10월.pdf',
  size: 183204,
  uploaded_at: '2026-10-16T21:12:00+09:00',
};

function submission(
  id: string,
  kind: SubmissionKind,
  status: SubmissionStatus,
  extra: Partial<Submission> = {},
): Submission {
  return {
    id,
    kind,
    target_month: '2026-10',
    status,
    parent_id: null,
    submitted_at: status === 'draft' ? null : '2026-10-16T21:15:00+09:00',
    review_comment: null,
    required_doc_types:
      kind === 'initial'
        ? ['id_card', 'resident_abstract', 'bankbook', 'employment_insurance']
        : ['employment_insurance'],
    files: [],
    created_at: '2026-10-16T21:10:00+09:00',
    ...extra,
  };
}

const draft = submission('m-1', 'monthly', 'draft');

describe('monthlyOutcome', () => {
  it('does not count an initial as the monthly chain', () => {
    expect(monthlyOutcome([submission('i-1', 'initial', 'pending_review')])).toBeNull();
  });

  it('follows the monthly to its newest supplement', () => {
    const monthly = submission('m-1', 'monthly', 'resubmitted');
    const supplement = submission('s-1', 'supplement', 'resubmitted', { parent_id: 'm-1' });
    const other = submission('s-0', 'supplement', 'revision_requested', { parent_id: 'i-1' });
    const found = monthlyOutcome([
      supplement,
      other,
      monthly,
      submission('i-1', 'initial', 'approved'),
    ]);
    expect(found?.monthly.id).toBe('m-1');
    expect(found?.latest.id).toBe('s-1');
  });
});

describe('Monthly (U04)', () => {
  let http: HttpTestingController;

  function setup(): { fixture: ComponentFixture<Monthly>; el: HTMLElement } {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'history', component: Stub },
          { path: 'home', component: Stub },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).setMe({
      id: 1,
      login: 'dongmin',
      display_name: '동민',
      role: 'student',
      is_demo: true,
      study_hours: 0,
      employed: false,
      employment_updated_at: null,
      initial_submitted: true,
    });
    const fixture = TestBed.createComponent(Monthly);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  /** cycle → this month's final submissions, then (when none) the draft */
  async function load(
    fixture: ComponentFixture<Monthly>,
    items: Submission[],
    period: Cycle = cycle,
  ): Promise<void> {
    http.expectOne('/api/cycles/current').flush(period);
    await fixture.whenStable();
    const list = http.expectOne('/api/submissions?month=2026-10');
    list.flush({ items });
    await fixture.whenStable();
  }

  afterEach(() => http.verify());

  it('shows the covered screen, without creating a draft, when the month holds a submitted initial', async () => {
    const { fixture, el } = setup();
    await load(fixture, [submission('i-1', 'initial', 'pending_review')]);
    fixture.detectChanges();

    http.expectNone('/api/submissions');
    expect(el.querySelector('h1')?.textContent).toContain('이미 냈어요');
  });

  it('shows the covered screen when creating the draft is refused with INVALID_STATE', async () => {
    const { fixture, el } = setup();
    await load(fixture, []);
    http.expectOne('/api/submissions').flush(
      { error: { code: 'INVALID_STATE', message: '이 달은 최초 4종으로 이미 제출했습니다.' } },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('h1')?.textContent).toContain('이미 냈어요');
    expect(el.querySelector('.load-error')).toBeNull();
  });

  it('creates the monthly draft when the month holds no initial', async () => {
    const { fixture, el } = setup();
    await load(fixture, []);
    const create = http.expectOne('/api/submissions');
    expect(create.request.body).toEqual({ kind: 'monthly', target_month: '2026-10' });
    create.flush(draft);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('h1')?.textContent).toContain('10월 서류 제출');
    expect(el.querySelector('.period')?.textContent).toContain('접수 중 · 10월 31일 마감');
    expect(el.textContent).toContain('2026.10.01 이후 발급본');
    expect(el.querySelector('.aside dd')?.textContent?.trim()).toBe('10월 1일');
    // the period always opens at 00:00 on the 1st, so no start time is shown
    expect(el.textContent).not.toContain('00:00');
    expect(el.textContent).toContain('10월 31일 23:59');
    // closes_at is exclusive: next month's 1st 00:00 must never be shown
    expect(el.textContent).not.toContain('11월 1일');
  });

  it('disables submit until a PDF is there, then sends one key per attempt', async () => {
    const { fixture, el } = setup();
    await load(fixture, []);
    http.expectOne('/api/submissions').flush(draft);
    await fixture.whenStable();
    fixture.detectChanges();

    const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('.bar button')];
    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect(el.querySelector('.status')?.textContent).toContain(
      'PDF를 올리면 제출 버튼이 활성화돼요.',
    );

    const upload$ = () => {
      fixture.debugElement
        .query((d) => d.name === 'app-drop-panel')
        .triggerEventHandler('uploaded', upload);
      fixture.detectChanges();
    };
    upload$();
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['임시 저장', '서류 제출하기 →']);
    expect(buttons().every((b) => !b.disabled)).toBe(true);
    expect(el.querySelector('.status')?.textContent).toContain(
      '내 이름과 10월 1일 이후 발급일을 확인했어요.',
    );

    buttons()[1].click();
    const first = http.expectOne('/api/submissions/m-1/finalize');
    const key = first.request.headers.get(IDEMPOTENCY_HEADER);
    expect(key).toBeTruthy();
    first.flush(null, { status: 0, statusText: 'offline' });
    await fixture.whenStable();
    fixture.detectChanges();

    buttons()[1].click();
    const retry = http.expectOne('/api/submissions/m-1/finalize');
    expect(retry.request.headers.get(IDEMPOTENCY_HEADER)).toBe(key);
    retry.flush(null, { status: 500, statusText: 'error' });
    await fixture.whenStable();
    fixture.detectChanges();

    upload$();
    buttons()[1].click();
    const fresh = http.expectOne('/api/submissions/m-1/finalize');
    expect(fresh.request.headers.get(IDEMPOTENCY_HEADER)).not.toBe(key);
    fresh.flush({ ...draft, status: 'pending_review', submitted_at: '2026-10-05T09:41:00+09:00' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('h1')?.textContent).toContain('동민님, 서류가 잘 도착했어요!');
    expect(el.textContent).toContain('2026.10.05 09:41');
    expect(el.textContent).not.toContain('접수 번호');
  });

  it('shows the done screen for an already submitted monthly', async () => {
    const { fixture, el } = setup();
    await load(fixture, [submission('m-1', 'monthly', 'approved')]);
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('서류가 잘 도착했어요!');
    expect(el.querySelector('app-status-badge')?.textContent).toContain('서류 승인');
  });

  describe('supplement (U05)', () => {
    const requested = submission('m-1', 'monthly', 'revision_requested', {
      review_comment: '10월 1일 이후 발급본이 아닙니다.',
      files: [{ ...upload, original_name: '고용보험_0831.pdf' }],
    });
    const supplementDraft = submission('s-1', 'supplement', 'draft', {
      parent_id: 'm-1',
    });
    const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.bar button')];

    async function open(period: Cycle = cycle, reply: Submission | 'closed' = supplementDraft) {
      const { fixture, el } = setup();
      await load(fixture, [requested], period);
      const create = http.expectOne('/api/submissions');
      expect(create.request.body).toEqual({
        kind: 'supplement',
        target_month: '2026-10',
        parent_id: 'm-1',
      });
      if (reply === 'closed') {
        create.flush(closedBody, { status: 422, statusText: 'Unprocessable' });
      } else {
        create.flush(reply);
      }
      await fixture.whenStable();
      fixture.detectChanges();
      return { fixture, el };
    }

    it('shows the supplement screen inside /submit with the review comment (final U05-supplement-ready)', async () => {
      const { el } = await open();
      expect(el.querySelector('.eyebrow')?.textContent).toContain('한 가지만 더 확인해주세요');
      expect(el.querySelector('h1')?.textContent).toBe('한 부분만 보완하면 돼요');
      expect(el.querySelector('.tag')?.textContent).toBe('보완 요청');
      const box = el.querySelector('app-info-box')!;
      expect(box.textContent).toContain('고용보험가입내역서를 다시 올려주세요');
      expect(box.textContent).toContain('10월 1일 이후 발급본이 아닙니다.');
      expect(el.querySelector('.previous')?.textContent).toContain('고용보험_0831.pdf');
      const record = el.querySelectorAll('app-card')[1].textContent;
      expect(record).toContain('운영 담당자');
      expect(record).toContain('10.16 21:15 최초 제출');
      expect(record).toContain('2026.10.31 23:59');
      expect(record).not.toContain('2026.11.01');
      expect(el.textContent).not.toContain('미리보기');
      expect(buttons(el).map((b) => [b.textContent?.trim(), b.disabled])).toEqual([
        ['임시 저장', true],
        ['보완 서류 다시 제출하기 →', true],
      ]);
      expect(el.querySelector('.status')?.textContent).toContain(
        '새 PDF를 올리면 제출할 수 있어요.',
      );
      expect(el.querySelector('.confirm')).toBeNull();
    });

    it('hides the deadline when the supplement is for another month than the cycle', async () => {
      // /submit only reaches the screen for the cycle's month, so test the component directly
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });
      http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(Supplement);
      fixture.componentRef.setInput('root', requested);
      fixture.componentRef.setInput('parent', requested);
      fixture.componentRef.setInput('cycle', { ...cycle, target_month: '2026-11' });
      fixture.detectChanges();
      await fixture.whenStable();
      http.expectOne('/api/submissions').flush(supplementDraft);
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).not.toContain('보완 제출 기한');
      expect(el.textContent).toContain('운영 담당자');
    });

    it('submits the supplement with one key and lands on the re-review screen', async () => {
      const { fixture, el } = await open();
      fixture.debugElement
        .query((d) => d.name === 'app-upload-slot')
        .triggerEventHandler('uploaded', { ...upload, original_name: '고용보험_수정.pdf' });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('.confirm')?.textContent).toContain(
        '10월 1일 이후에 발급된 서류인지 확인했어요.',
      );
      expect(el.querySelector('.status')?.textContent).toContain('새 PDF 1개가 준비되었어요.');

      buttons(el)[1].click();
      const first = http.expectOne('/api/submissions/s-1/finalize');
      const key = first.request.headers.get(IDEMPOTENCY_HEADER);
      expect(key).toBeTruthy();
      first.flush(null, { status: 0, statusText: 'offline' });
      await fixture.whenStable();
      fixture.detectChanges();

      buttons(el)[1].click();
      const retry = http.expectOne('/api/submissions/s-1/finalize');
      expect(retry.request.headers.get(IDEMPOTENCY_HEADER)).toBe(key);
      retry.flush({
        ...supplementDraft,
        status: 'resubmitted',
        submitted_at: '2026-10-17T10:00:00+09:00',
      });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector('h1')?.textContent).toContain('서류가 잘 도착했어요!');
      expect(el.querySelector('app-status-badge')?.textContent).toContain('재검토 대기');
    });

    it('locks the row and the button after the period (no draft)', async () => {
      const { el } = await open({ ...cycle, state: 'closed' }, 'closed');
      expect(buttons(el).map((b) => [b.textContent?.trim(), b.disabled])).toEqual([
        ['제출 기간 종료', true],
      ]);
      expect(el.querySelector('app-upload-slot button')?.hasAttribute('disabled')).toBe(true);
      expect(el.querySelector('.load-error')).toBeNull();
    });
  });

  const closedBody = {
    error: { code: 'CYCLE_CLOSED', message: '접수 기간이 아닙니다.' },
  };
  const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.bar button')];

  it('shows the saved file when the period is closed (final U04-monthly-closed)', async () => {
    const { fixture, el } = setup();
    await load(fixture, [], { ...cycle, target_month: '2026-10', state: 'closed' });
    http.expectOne('/api/submissions').flush({ ...draft, files: [upload] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.state')?.textContent).toBe('접수 마감');
    expect(el.querySelector('app-info-box')?.textContent).toContain(
      '저장한 파일은 그대로 남아 있어요',
    );
    expect(el.querySelector('app-info-box')?.textContent).toContain(
      '10월 31일 23:59에 접수가 마감됐어요',
    );
    expect(el.querySelector('app-drop-panel')?.textContent).toContain('임시 저장한 파일');
    expect(el.querySelector('app-drop-panel button')?.hasAttribute('disabled')).toBe(true);
    expect(el.querySelector('.status')?.textContent).toContain('10월 접수가 끝났어요.');
    expect(buttons(el).map((b) => b.textContent?.trim())).toEqual(['제출 기간 종료']);
    expect(buttons(el)[0].disabled).toBe(true);
    expect(el.querySelector('.load-error')).toBeNull();
  });

  it('closed without a saved draft: no error line, submit locked', async () => {
    const { fixture, el } = setup();
    await load(fixture, [], { ...cycle, state: 'closed' });
    http
      .expectOne('/api/submissions')
      .flush(closedBody, { status: 422, statusText: 'Unprocessable' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.state')?.textContent).toBe('접수 마감');
    expect(el.querySelector('app-notice-panel')?.textContent).toContain('이번 달 접수가 끝났어요');
    expect(el.querySelector('app-notice-panel')?.textContent).toContain('저장된 파일이 없어요.');
    expect(el.querySelector('app-drop-panel')).toBeNull();
    expect(buttons(el)[0].disabled).toBe(true);
    expect(el.querySelector('.load-error')).toBeNull();
  });

  it('before the period opens: no draft call, notice panel and 접수 시작 bar (final U04-monthly-upcoming)', async () => {
    const { fixture, el } = setup();
    await load(fixture, [], { ...cycle, state: 'upcoming' });
    // http.verify() in afterEach fails if POST /api/submissions was sent
    fixture.detectChanges();

    expect(el.querySelector('.state')?.textContent).toBe('접수 예정');
    expect(el.querySelector('app-notice-panel')?.textContent).toContain(
      '10월 1일부터 제출할 수 있어요',
    );
    expect(el.querySelector('app-notice-panel')?.textContent).toContain(
      '10월 1일부터 PDF를 제출할 수 있어요.',
    );
    expect(el.querySelector('app-drop-panel')).toBeNull();
    expect(el.querySelector('.status')?.textContent).toContain('접수 시작 2026.10.01');
    expect(el.textContent).not.toContain('00:00');
    expect(buttons(el).map((b) => b.textContent?.trim())).toEqual(['접수 시작 전']);
    expect(buttons(el)[0].disabled).toBe(true);
  });

  it('a month with no period set creates no draft and shows no status text on the right', async () => {
    const { fixture, el } = setup();
    await load(fixture, [], {
      ...cycle,
      state: 'not_set',
      opens_at: null,
      closes_at: null,
      d_day: null,
    });
    fixture.detectChanges();

    expect(el.querySelector('.state')).toBeNull();
    expect(el.querySelector('.period')).toBeNull();
    expect(el.querySelector('app-notice-panel')?.textContent).toContain(
      '접수 기간이 아직 정해지지 않았어요',
    );
    expect(el.querySelector('.status')?.textContent).toContain('접수 기간 미정');
    expect(buttons(el)[0].textContent?.trim()).toBe('접수 시작 전');
    expect(buttons(el)[0].disabled).toBe(true);
  });
});
