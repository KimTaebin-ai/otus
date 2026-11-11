import { NoticeChannel } from '../core/notice-channel';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { NoticeDelivery, NoticePreviewResponse } from '../core/notices-api';
import { Notices } from './notices';

const PREVIEW: NoticePreviewResponse = {
  month: '2026-10',
  months: ['2026-10'],
  audience: 'unsubmitted',
  audiences: ['unsubmitted'],
  matched: 2,
  hours_unknown: 0,
  closes_at: '2026-11-01T00:00:00+09:00',
  unsubmitted: 2,
  employed_excluded: 1,
  employed_names: ['취업 예시'],
  targets: [
    {
      user_id: 31,
      name: '안내 예시',
      login: 'dummy',
      employed: false,
      status: 'draft',
      study_hours: 0,
      as_of: '2026-10-18T14:00:00+09:00',
      email: 'dummy@example.test',
    },
  ],
  target_fingerprint: 'a'.repeat(64),
  email_available: true,
};
const DELIVERY: NoticeDelivery = {
  notice_id: 17,
  channel: 'both',
  audience: 'unsubmitted',
  month: '2026-10',
  sent: 1,
  failed: 0,
  service: { sent: 1, failed: 0 },
  email: { pending: 1, sending: 0, sent: 0, failed: 0, skipped: 0 },
  employed_excluded: 1,
  sent_at: '2026-10-18T14:30:00+09:00',
};
const SETTLED: NoticeDelivery = {
  ...DELIVERY,
  email: { pending: 0, sending: 0, sent: 1, failed: 0, skipped: 0 },
};
const FAILED: NoticeDelivery = {
  ...DELIVERY,
  email: { pending: 0, sending: 0, sent: 0, failed: 1, skipped: 0 },
};
const SERVICE_DELIVERY: NoticeDelivery = {
  ...DELIVERY,
  channel: 'service',
  email: { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 },
};
const PREVIEW_URL = '/api/admin/notices/submission-reminder';

describe('Notices: one page to write, select and send', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let el: HTMLElement;
  const title = '10월 서류 안내';
  const body = '서류를 확인해주세요.\n\n문의는 운영팀에 남겨주세요.';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'notices', component: Notices }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    harness?.fixture.destroy();
    http.verify({ ignoreCancelled: true });
    vi.useRealTimers();
  });
  async function open(url = '/notices') {
    harness = await RouterTestingHarness.create(url);
    el = harness.routeNativeElement as HTMLElement;
  }
  const button = (text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  function click(text: string) {
    button(text).click();
    harness.detectChanges();
  }
  async function compose() {
    await harness.fixture.whenStable();
    for (const [id, value] of [
      ['notice-title', title],
      ['notice-body', body],
    ]) {
      const input = el.querySelector<HTMLInputElement>('#' + id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await harness.fixture.whenStable();
    harness.detectChanges();
  }
  function check(id: string, checked = true) {
    const input = el.querySelector<HTMLInputElement>('#' + id)!;
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
    harness.detectChanges();
  }
  function preview(response = PREVIEW) {
    const req = http.expectOne((r) => r.method === 'GET' && r.url === PREVIEW_URL);
    req.flush(response);
    harness.detectChanges();
    return req;
  }
  async function live(response = PREVIEW, channel: NoticeChannel = 'both') {
    await open();
    await compose();
    check('audience-unsubmitted');
    preview(response);
    check('channel-service', channel !== 'email');
    check('channel-email', channel !== 'service');
  }
  function submit() {
    click('발송하기');
    click('최종 발송하기');
    return http.expectOne((r) => r.method === 'POST' && r.url === PREVIEW_URL);
  }
  async function poll(response = SETTLED) {
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/admin/notices/17').flush(response);
    harness.detectChanges();
  }

  it('is one page: write, pick channel and targets, see the roster, then send from the same screen', async () => {
    await open();
    expect(el.querySelector('.steps')).toBeNull();
    expect(button('발송하기').disabled).toBe(true);
    expect(el.querySelector('#notice-title')).not.toBeNull();
    expect(
      [...el.querySelectorAll('input[id^="audience-"]')].map((input) =>
        input.parentElement?.textContent?.trim(),
      ),
    ).toEqual(['미제출', '40시간 미만', '40~80시간 구간', '80시간 이상', '취업자', '전체 학생']);
    expect(el.textContent).toContain('발송 대상을 체크하면 명단이 표시돼요.');
    expect(el.textContent).toContain('알림 제목과 내용을 입력해주세요.');
    http.expectNone(() => true);
    await compose();
    expect(el.textContent).toContain('발송 대상을 하나 이상 선택해주세요.');
    check('audience-unsubmitted');
    expect(preview().request.params.get('audiences')).toBe('unsubmitted');
    expect(el.textContent).toContain('안내 예시');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.querySelector('.send-summary')?.textContent).toContain('1명');
    expect(button('발송하기').disabled).toBe(false);
    // the send check opens on this same page; nothing is sent yet
    click('발송하기');
    const confirm = el.querySelector('[aria-label="최종 발송 확인"]')!;
    expect(confirm.textContent).toContain(title);
    expect(confirm.textContent).toContain(body);
    await harness.fixture.whenStable();
    expect(el.querySelector('#notice-title')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('#notice-title')!.disabled).toBe(true);
    http.expectNone((r) => r.method === 'POST');
    click('수정하기');
    expect(el.querySelector('[aria-label="최종 발송 확인"]')).toBeNull();
    await harness.fixture.whenStable();
    expect(el.querySelector<HTMLTextAreaElement>('#notice-body')!.value).toBe(body);
    expect(el.querySelector<HTMLInputElement>('#notice-title')!.disabled).toBe(false);
  });

  it('keeps the draft and selections when going back from the send check, and sends the edit only after final confirmation', async () => {
    await live(PREVIEW, 'email');
    click('발송하기');
    click('수정하기');
    expect(el.querySelector<HTMLInputElement>('#audience-unsubmitted')!.checked).toBe(true);
    expect(el.querySelector<HTMLInputElement>('#channel-email')!.checked).toBe(true);
    expect(el.querySelector<HTMLInputElement>('#channel-service')!.checked).toBe(false);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    http.expectNone(() => true);
    const input = el.querySelector<HTMLTextAreaElement>('#notice-body')!;
    const edited = '수정한 알림 내용';
    input.value = edited;
    input.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
    http.expectNone((r) => r.method === 'POST');
    const send = submit();
    expect(send.request.body).toMatchObject({
      title,
      body: edited,
      audiences: ['unsubmitted'],
      channel: 'email',
      target_fingerprint: PREVIEW.target_fingerprint,
    });
    expect(button('수정하기').disabled).toBe(true);
    click('수정하기');
    expect(el.querySelector('[aria-label="최종 발송 확인"]')).not.toBeNull();
    vi.useFakeTimers();
    send.flush({ ...SETTLED, channel: 'email', sent: 0, service: { sent: 0, failed: 0 } });
    await poll({ ...SETTLED, channel: 'email', sent: 0, service: { sent: 0, failed: 0 } });
  });

  it('cannot be sent while the roster is still loading, and cancels an obsolete lookup', async () => {
    await open();
    await compose();
    check('audience-unsubmitted');
    const stale = http.expectOne((r) => r.method === 'GET');
    expect(button('발송하기').disabled).toBe(true);
    expect(el.textContent).toContain('학생을 확인하고 있어요');
    check('audience-under_40');
    expect(stale.cancelled).toBe(true);
    expect(preview().request.params.get('audiences')).toBe('unsubmitted,under_40');
    expect(button('발송하기').disabled).toBe(false);
    http.expectNone((r) => r.method === 'POST');
  });

  it('selects multiple audiences and sends exact content, the deduplicated server list and fingerprint', async () => {
    await live();
    check('audience-hours_40_80');
    const req = preview({ ...PREVIEW, audiences: ['hours_40_80', 'unsubmitted'] });
    expect(req.request.params.get('audiences')).toBe('unsubmitted,hours_40_80');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    vi.useFakeTimers();
    const send = submit();
    expect(send.request.body).toEqual({
      month: '2026-10',
      audiences: ['hours_40_80', 'unsubmitted'],
      channel: 'both',
      title,
      body,
      expected_count: 1,
      target_fingerprint: PREVIEW.target_fingerprint,
    });
    expect(button('발송 결과 확인 중').disabled).toBe(true);
    click('발송 결과 확인 중');
    http.expectNone((r) => r.method === 'POST');
    send.flush(DELIVERY);
    await poll();
    expect(el.textContent).toContain('앱 내부 알림 1명에게 전달했어요');
    await vi.advanceTimersByTimeAsync(4000);
    http.expectNone('/api/admin/notices/17');
  });

  it('makes all students explicit and cancels obsolete previews when groups change', async () => {
    await live();
    check('audience-hours_40_80');
    const stale = http.expectOne((r) => r.method === 'GET');
    check('audience-all');
    expect(stale.cancelled).toBe(true);
    const req = preview({
      ...PREVIEW,
      audiences: ['all'],
      employed_excluded: 0,
      targets: [{ ...PREVIEW.targets[0], employed: true }],
    });
    expect(req.request.params.get('audiences')).toBe('all');
    expect(el.querySelector<HTMLInputElement>('#audience-unsubmitted')!.checked).toBe(false);
    expect(el.querySelector<HTMLInputElement>('#audience-hours_40_80')!.checked).toBe(false);
    expect(el.textContent).toContain('최초 등록 전·취업 중인 학생도 포함');
    check('audience-all', false);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(button('발송하기').disabled).toBe(true);
    http.expectNone(() => true);
  });

  it('previews employed students, keeps them in a union, and includes the selection in the final send', async () => {
    await open();
    await compose();
    check('audience-employed');
    const employed: NoticePreviewResponse = {
      ...PREVIEW,
      audiences: ['employed'],
      employed_excluded: 0,
      targets: [{ ...PREVIEW.targets[0], employed: true, study_hours: null }],
    };
    expect(preview(employed).request.params.get('audiences')).toBe('employed');
    expect(el.querySelector('tbody')?.textContent).toContain('취업 중');
    expect(el.textContent).not.toContain('취업 중 0명 제외');
    check('audience-at_least_80');
    const union = preview({ ...employed, audiences: ['at_least_80', 'employed'] });
    expect(union.request.params.get('audiences')).toBe('employed,at_least_80');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    check('audience-all');
    preview({ ...employed, audiences: ['all'] });
    expect(el.querySelector<HTMLInputElement>('#audience-employed')!.checked).toBe(false);
    check('audience-employed');
    preview(employed);
    expect(el.querySelector<HTMLInputElement>('#audience-all')!.checked).toBe(false);
    click('발송하기');
    expect(el.querySelector('[aria-label="최종 발송 확인"]')?.textContent).toContain('취업자');
    click('최종 발송하기');
    const send = http.expectOne((r) => r.method === 'POST' && r.url === PREVIEW_URL);
    expect(send.request.body.audiences).toEqual(['employed']);
    send.flush({ ...SERVICE_DELIVERY, audiences: ['employed'] });
  });

  it('clears old recipients while a new preview is loading and does not allow sending an empty result', async () => {
    await live();
    check('audience-under_40');
    expect(button('발송하기').disabled).toBe(true);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(0);
    preview({ ...PREVIEW, targets: [], audiences: ['under_40', 'unsubmitted'] });
    expect(button('발송하기').disabled).toBe(true);
    expect(el.textContent).toContain('해당하는 학생이 없어요');
  });

  it('requires at least one channel and disables unavailable email without hiding service delivery', async () => {
    await live({ ...PREVIEW, email_available: false }, 'service');
    expect(el.querySelector<HTMLInputElement>('#channel-email')!.disabled).toBe(true);
    check('channel-service', false);
    expect(button('발송하기').disabled).toBe(true);
    check('channel-email');
    expect(button('발송하기').disabled).toBe(true);
    check('channel-service');
    vi.useFakeTimers();
    const req = submit();
    expect(req.request.body.channel).toBe('service');
    req.flush(SERVICE_DELIVERY);
    harness.detectChanges();
    expect(el.querySelector('[role="dialog"]')?.textContent).not.toContain('이메일 발송 현황');
    await vi.advanceTimersByTimeAsync(4000);
    http.expectNone((r) => r.method === 'GET');
  });

  it('sends email only and never reports app delivery', async () => {
    await live(PREVIEW, 'email');
    vi.useFakeTimers();
    const req = submit();
    expect(req.request.body.channel).toBe('email');
    const email = {
      ...FAILED,
      channel: 'email' as const,
      sent: 0,
      service: { sent: 0, failed: 0 },
    };
    req.flush(email);
    await poll(email);
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('이메일 발송 현황');
    expect(dialog.textContent).not.toContain('알림 벨');
    expect(dialog.textContent).not.toContain('앱 내부 알림 0명');
  });

  it('preserves the exact key, content, audiences and channels after a lost send response', async () => {
    await live();
    vi.useFakeTimers();
    const first = submit();
    const key = first.request.headers.get('Idempotency-Key');
    const payload = first.request.body;
    first.error(new ProgressEvent('error'));
    harness.detectChanges();
    expect(button('수정하기').disabled).toBe(true);
    click('수정하기');
    expect(el.querySelector('[aria-label="최종 발송 확인"]')).not.toBeNull();
    expect(el.querySelector('fieldset')!.disabled).toBe(true);
    click('발송 결과 다시 확인');
    const retry = http.expectOne((r) => r.method === 'POST');
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    expect(retry.request.body).toEqual(payload);
    retry.flush(DELIVERY);
    await poll();
  });

  it('refreshes a changed audience after 409 and requires explicit confirmation again', async () => {
    await live();
    submit().flush(
      { error: { code: 'INVALID_STATE', message: '대상이 바뀌었습니다.' } },
      { status: 409, statusText: 'Conflict' },
    );
    preview({ ...PREVIEW, target_fingerprint: 'b'.repeat(64) });
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.textContent).toContain('대상이 바뀌었습니다.');
    expect(el.querySelector<HTMLInputElement>('#notice-title')!.value).toBe(title);
    http.expectNone((r) => r.method === 'POST');
  });

  it('only retries email after confirmation and preserves the retry key on lost responses', async () => {
    await live();
    vi.useFakeTimers();
    submit().flush(FAILED);
    await poll(FAILED);
    click('실패한 이메일 다시 보내기');
    http.expectNone((r) => r.method === 'POST');
    click('이메일 재시도 확정');
    const first = http.expectOne('/api/admin/notices/17/retry');
    const key = first.request.headers.get('Idempotency-Key');
    first.error(new ProgressEvent('error'));
    harness.detectChanges();
    click('재시도 결과 다시 확인');
    const second = http.expectOne('/api/admin/notices/17/retry');
    expect(second.request.headers.get('Idempotency-Key')).toBe(key);
    second.flush({ ...DELIVERY, sent: 0, service: { sent: 0, failed: 0 }, retried: 1 });
    harness.detectChanges();
    expect(el.textContent).toContain('앱 내부 알림 1명에게 전달했어요');
    await poll();
  });

  it('starts a fresh draft after completion and gives the next explicit send a new key', async () => {
    await live(PREVIEW, 'service');
    const first = submit();
    const key = first.request.headers.get('Idempotency-Key');
    first.flush(SERVICE_DELIVERY);
    harness.detectChanges();
    click('확인 · 안내 화면으로');
    expect(el.querySelector<HTMLInputElement>('#notice-title')!.value).toBe('');
    expect(button('발송하기').disabled).toBe(true);
    await compose();
    check('audience-unsubmitted');
    preview();
    const second = submit();
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(key);
    second.flush(SERVICE_DELIVERY);
  });

  it('keeps the draft while changing month and cancels the stale month lookup', async () => {
    await open('/notices?month=2026-10');
    await compose();
    check('audience-unsubmitted');
    const stale = http.expectOne((r) => r.method === 'GET');
    await harness.navigateByUrl('/notices?month=2026-09');
    expect(stale.cancelled).toBe(true);
    const req = preview({ ...PREVIEW, month: '2026-09' });
    expect(req.request.params.get('month')).toBe('2026-09');
    expect(el.querySelector<HTMLInputElement>('#notice-title')!.value).toBe(title);
    expect(el.textContent).toContain('2026-09 기준');
  });

  it('does not send when preview fails and allows refreshing the list', async () => {
    await open();
    await compose();
    check('audience-unsubmitted');
    http
      .expectOne((r) => r.method === 'GET')
      .flush(
        { error: { code: 'INTERNAL_ERROR', message: '조회 실패' } },
        { status: 500, statusText: 'Error' },
      );
    harness.detectChanges();
    expect(button('발송하기').disabled).toBe(true);
    click('명단 새로고침');
    preview();
    expect(button('발송하기').disabled).toBe(false);
    http.expectNone((r) => r.method === 'POST');
  });

  it('keeps development previews isolated from all HTTP requests', async () => {
    await open('/notices?preview');
    await compose();
    check('audience-unsubmitted');
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(el.querySelectorAll('tbody tr')).toHaveLength(7);
    });
    click('발송하기');
    click('최종 발송하기');
    expect(el.querySelector('[role="dialog"]')?.textContent).toContain('7명에게 안내를 보냈어요');
    http.expectNone(() => true);
  });
});
