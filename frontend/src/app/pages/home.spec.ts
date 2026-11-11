import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { BankAccountState, Cycle, Me, Submission } from '../core/api.models';
import { AuthService } from '../core/auth.service';
import { Home } from './home';

/** GET /api/cycles/current (api.md) */
const cycle: Cycle = {
  target_month: '2026-10',
  state: 'open',
  opens_at: '2026-10-01T00:00:00+09:00',
  closes_at: '2026-11-01T00:00:00+09:00',
  d_day: 15,
  issued_after: '2026-10-01',
};

/** GET /api/me/bank-account with an approved account */
const bank: BankAccountState = {
  current: {
    bank: '카카오뱅크',
    account_number_masked: '•••• 1234',
    status: 'approved',
    requested_at: '2026-09-01T10:00:00+09:00',
    decided_at: '2026-09-02T10:00:00+09:00',
    decision_note: null,
    bankbook: null,
  },
  pending: null,
  last_rejected: null,
};

const uploaded_at = '2026-10-16T21:12:00+09:00';

const initial: Submission = {
  id: 's-1',
  kind: 'initial',
  target_month: '2026-10',
  status: 'pending_review',
  parent_id: null,
  submitted_at: '2026-10-16T21:15:00+09:00',
  review_comment: null,
  required_doc_types: ['id_card', 'resident_abstract', 'bankbook', 'employment_insurance'],
  files: [
    { file_id: 'f-1', doc_type: 'id_card', original_name: 'a.pdf', size: 1024, uploaded_at },
    {
      file_id: 'f-2',
      doc_type: 'resident_abstract',
      original_name: 'b.pdf',
      size: 1024,
      uploaded_at,
    },
    { file_id: 'f-3', doc_type: 'bankbook', original_name: 'c.pdf', size: 1024, uploaded_at },
    {
      file_id: 'f-4',
      doc_type: 'employment_insurance',
      original_name: 'd.pdf',
      size: 1024,
      uploaded_at,
    },
  ],
  created_at: '2026-10-16T21:10:00+09:00',
};

const timeRequirements = {
  items: [
    {
      month: '2026-10',
      phase: 'in_progress',
      as_of: '2026-10-17T14:00:00+09:00',
      recognized_seconds: 79200,
      thresholds: [
        { tier: 'tier_1', seconds: 144000, amount: 500000 },
        { tier: 'tier_2', seconds: 288000, amount: 1000000 },
      ],
      projected_tier: null,
      decides_at: '2026-11-01T00:00:00+09:00',
      result: null,
      final: { status: 'undecided', amount: null, decided_at: null },
    },
  ],
};

describe('Home (U03)', () => {
  let fixture: ComponentFixture<Home>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /** Signs in with the study-hours bucket supplied by GET /api/me. */
  function open(studyHours: Me['study_hours'] = 40, employed = false): void {
    TestBed.inject(AuthService).setMe({
      id: 1,
      login: 'dongmin',
      display_name: '동민',
      role: 'student',
      is_demo: true,
      study_hours: studyHours,
      employed,
      employment_updated_at: null,
      initial_submitted: true,
    });
    fixture = TestBed.createComponent(Home);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  async function load(
    month: Submission[],
    recent: Submission[],
    studyHours: Me['study_hours'] = 40,
    employed = false,
  ): Promise<void> {
    open(studyHours, employed);
    http.expectOne('/api/cycles/current').flush(cycle);
    http.expectOne((r) => r.params.get('month') === '2026-10').flush({ items: month });
    http
      .expectOne((r) => r.url === '/api/submissions' && !r.params.has('month'))
      .flush({ items: recent });
    await fixture.whenStable();
    // the layout loads the account for "내 정보" once it's on screen
    fixture.detectChanges();
    http.expectOne('/api/me/bank-account').flush(bank);
    // the 자격 요건 card reads the recognized seconds for its progress bar (not shown when employed)
    const bars = http.match((r) => r.url === '/api/me/time-requirements');
    expect(bars.length).toBe(employed ? 0 : 1);
    bars.forEach((r) => r.flush(timeRequirements));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the submitted layout when this month has a final submission', async () => {
    await load([initial], [initial]);
    expect(el.querySelector('h1')?.textContent).toContain('동민님, 반가워요!');
    expect(el.querySelector('.hero h2')?.textContent?.trim()).toBe('첫 서류 4개, 잘 도착했어요');
    expect(el.querySelector('.tag')?.textContent?.trim()).toBe('서류 확인 중');
    expect(el.querySelector('.received')?.textContent).toContain('10월 16일 21:15');
    expect(el.querySelector('.recent-title')?.textContent?.trim()).toBe(
      '2026년 10월 · 최초 서류 4종',
    );
    expect(el.querySelector('.facts')?.textContent).toContain('카카오뱅크 · •••• 1234');
    // the period starts on the 1st at 00:00, so only the day is shown
    const faq = el.querySelector('.faq .answer')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(faq).toBe('10월 1일부터 10월 31일 밤 11시 59분까지예요.');
  });

  it('shows the employment state and its FAQ answer', async () => {
    await load([initial], [initial]);
    expect(el.querySelector('.facts')?.textContent).toContain('미취업');
    expect(el.querySelector('.state')?.textContent).toContain('미취업');
    expect(el.textContent).toContain('부정수급');
    TestBed.inject(AuthService).setMe({ ...TestBed.inject(AuthService).me()!, employed: true });
    fixture.detectChanges();
    expect(el.querySelector('.facts')?.textContent).toContain('취업 중');
    expect(el.querySelector('.state')?.textContent).toContain('취업 중');
    expect(el.querySelector('a[href="/settings"]')?.textContent?.trim()).toBe('설정 →');
  });

  it('switches the hero copy for revision_requested', async () => {
    const revision = { ...initial, status: 'revision_requested' as const };
    await load([revision], [revision]);
    expect(el.querySelector('.hero h2')?.textContent?.trim()).toBe('보완이 필요한 서류가 있어요');
    expect(el.querySelector('.tag')?.textContent?.trim()).toBe('서류 보완 필요');
    expect(el.querySelector('.hero button')?.textContent?.trim()).toBe('보완 제출하기 →');
  });

  it('puts a revision request on an older 최초 4종 first and links to its own screen', async () => {
    const revision = { ...initial, target_month: '2026-09', status: 'revision_requested' as const };
    const monthly = {
      ...initial,
      id: 'm-1',
      kind: 'monthly' as const,
      files: initial.files.slice(3),
    };
    // this month has an unrelated monthly under review; the initial chain still comes first
    await load([monthly], [monthly, revision]);
    expect(el.querySelector('.hero h2')?.textContent?.trim()).toBe('보완이 필요한 서류가 있어요');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    (el.querySelector('.hero button') as HTMLButtonElement).click();
    expect(navigate.mock.calls[0][0].toString()).toBe('/submit/initial');
  });

  it('uses the month in the monthly and approved hero titles', async () => {
    const monthly = { ...initial, kind: 'monthly' as const, files: initial.files.slice(3) };
    await load([monthly], [monthly]);
    expect(el.querySelector('.hero h2')?.textContent?.trim()).toBe('10월 서류가 잘 도착했어요');
  });

  it('shows the approved hero', async () => {
    const approved = { ...initial, status: 'approved' as const };
    await load([approved], [approved]);
    expect(el.querySelector('.hero h2')?.textContent?.trim()).toBe('10월 서류 확인이 끝났어요');
    expect(el.querySelector('.tag')?.textContent?.trim()).toBe('서류 승인');
  });

  it('shows the due layout when this month has no final submission', async () => {
    const september = { ...initial, target_month: '2026-09' };
    await load([], [september]);
    expect(el.querySelector('h1')?.textContent).toContain('동민님, 10월 서류를 낼 차례예요');
    expect(el.querySelector('.actions button')?.textContent?.trim()).toBe('10월 서류 제출하기');
    expect(el.querySelector('.stats')?.textContent).toContain('10.31');
    expect(el.querySelector('.stats')?.textContent).toContain('23:59');
    expect(el.querySelector('.hero')).toBeNull();
    const notice = el.querySelector('.notice p')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(notice).toContain('접수는 10월 1일부터 10월 31일 23:59까지예요.');
    expect(el.querySelector('.lines')?.textContent).toContain('10.01 · 서류 제출 안내');
    expect(el.textContent).not.toContain('00:00');
    expect(el.textContent).not.toContain('대상 여부가 다르면');
    expect(el.querySelector('.facts')?.textContent).toContain('카카오뱅크 · •••• 1234');
    expect(el.querySelector('a[href="/settings"]')?.textContent?.trim()).toBe('설정 →');
  });

  it('shows a compact qualification summary before the submission hero', async () => {
    await load([initial], [initial]);
    const hero = el.querySelector('app-hours-hero');
    expect(hero?.querySelector('h2')?.textContent).toBe('자격 요건');
    expect(hero?.querySelector('.headline')?.textContent).toBe('40시간 이상 (예상)');
    expect(hero?.querySelector('app-time-badge, .recipient, .hours, .notes')).toBeNull();
    expect(hero?.textContent).not.toContain('만 원');
    const all = [...el.querySelectorAll('app-hours-hero, .hero')];
    expect(all[0].tagName.toLowerCase()).toBe('app-hours-hero');
  });

  it('uses all three /api/me buckets and responds to profile updates', async () => {
    await load([initial], [initial], 0);
    const auth = TestBed.inject(AuthService);
    for (const [study_hours, label] of [
      [0, '40시간 미만 (예상)'],
      [40, '40시간 이상 (예상)'],
      [80, '80시간 이상 (예상)'],
    ] as const) {
      auth.setMe({ ...auth.me()!, study_hours });
      fixture.detectChanges();
      expect(el.querySelector('app-hours-hero .headline')?.textContent).toBe(label);
    }
  });

  it('draws the progress bar from the current month under the qualification headline', async () => {
    await load([initial], [initial]);
    const bar = el.querySelector('.hours-hero app-hours-bar [role=progressbar]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('79200');
    expect(bar?.getAttribute('aria-valuemax')).toBe('288000');
  });

  it('shows the same qualification summary on the due layout', async () => {
    await load([], [], 80);
    expect(el.querySelector('.due app-hours-hero .headline')?.textContent).toBe('80시간 이상 (예상)');
    expect(el.querySelector('.stats')?.textContent).not.toContain('수령 대상');
  });

  it('keeps the summary hidden for employed students', async () => {
    await load([initial], [initial], 40, true);
    expect(el.querySelector('app-hours-hero')).toBeNull();
  });

  it('does not mislabel an unavailable value and keeps the rest of the page', async () => {
    await load([initial], [initial], null);
    expect(el.querySelector('app-hours-hero .failed')?.textContent).toContain(
      '자격 요건을 불러오지 못했어요',
    );
    expect(el.querySelector('app-hours-hero .headline')).toBeNull();
    expect(el.querySelector('.hero h2')).not.toBeNull();
  });
});
