import { studentLabel } from '../core/cohort';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Role } from '@otus/shared/core/api-types';
import { AuthService } from '../core/auth.service';
import { UserRecord } from './user-record';

describe('UserRecord route', () => {
  let harness: RouterTestingHarness;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'users/:id', component: UserRecord }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  function login(role: Role): void {
    TestBed.inject(AuthService).setMe({
      id: 2,
      login: 'jiwoo',
      display_name: '지우',
      role,
      is_demo: true,
      study_hours: 0,
      employed: false,
      employment_updated_at: null,
      initial_submitted: false,
    });
  }

  async function open(url: string, expected: string): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    el = harness.routeNativeElement as HTMLElement;
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(el.textContent).toContain(expected);
    });
  }

  describe('without ?preview (GET /api/admin/users/{id})', () => {
    const DETAIL = {
      id: 7,
      login: 'dongmin',
      display_name: '동민',
      role: 'student',
      employed: true,
      employment_updated_at: '2026-09-01T10:00:00+09:00',
      initial_submitted: true,
    };

    it('shows the profile and says what the API does not give yet', async () => {
      login('operator');
      harness = await RouterTestingHarness.create('/users/7');
      el = harness.routeNativeElement as HTMLElement;
      TestBed.inject(HttpTestingController).expectOne('/api/admin/users/7').flush(DETAIL);
      harness.detectChanges();
      const text = el.textContent ?? '';
      expect(text).toContain(studentLabel('동민'));
      expect(text).toContain('취업 상태 · 취업 중 | 최초 서류 등록 완료');
      expect(text).toContain('최근 변경 2026.09.01');
      expect(text).toContain('검토 및 변경 기록은 관리자 API가 준비되면');
      expect(text).toContain('서류 목록은 관리자 API가 준비되면');
      expect(text).not.toContain('미제출');
      expect(text).not.toContain('등록된 계좌 없음');
      expect(el.querySelectorAll('tbody tr')).toHaveLength(0);
      expect(el.querySelectorAll('a.open')).toHaveLength(0);
    });

    it('says the student is not found on a 404', async () => {
      login('operator');
      harness = await RouterTestingHarness.create('/users/999');
      el = harness.routeNativeElement as HTMLElement;
      TestBed.inject(HttpTestingController)
        .expectOne('/api/admin/users/999')
        .flush(
          { error: { code: 'NOT_FOUND', message: 'x' } },
          { status: 404, statusText: 'Not Found' },
        );
      harness.detectChanges();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain('찾을 수 없는 교육생');
      expect(el.querySelector('a[href="/users"]')).not.toBeNull();
    });

    it('does not ask the server for an id that is not a whole number', async () => {
      login('operator');
      harness = await RouterTestingHarness.create('/users/abc');
      el = harness.routeNativeElement as HTMLElement;
      TestBed.inject(HttpTestingController).expectNone(() => true);
      expect(el.querySelector('[role="alert"]')?.textContent).toContain('찾을 수 없는 교육생');
    });
  });

  it('shows the header, the three cards, the record and the initial documents', async () => {
    login('accountant');
    await open('/users/1?preview', studentLabel('동민'));
    const text = el.textContent ?? '';
    expect(text).toContain('취업 상태 · 미취업 | 최초 서류 등록 완료 | 최근 제출 2026.09.21');
    expect(text).toContain('카카오뱅크 · •••• 1234');
    expect(text).toContain('검토 중');
    expect(text).toContain('서류 제출 · 검토 대기');
    expect(text).toContain('회계·지정 담당자');
    expect(text).toContain('최초 승인 2026.02.21 · 3종 보관 중');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(el.querySelector('a[href="/users"]')).toBeNull();
    expect(el.querySelector('button')?.textContent?.trim()).toBe('이번 달 제출 검토하기 →');
    // the account is only ever the last four digits: no digit run longer than 4 in its card
    const accountCard = [...el.querySelectorAll('app-stat-card')].find((c) =>
      c.textContent?.includes('받을 계좌'),
    )!;
    const runs = accountCard.textContent!.match(/\d+/g)!;
    expect(runs).toContain('1234');
    expect(runs.every((r) => r.length <= 4)).toBe(true);
  });

  for (const role of ['operator', 'accountant'] as const) {
    it(`lets ${role} open the originals`, async () => {
      login(role);
      await open('/users/1?preview', '최초 제출 서류');
      const links = [...el.querySelectorAll<HTMLAnchorElement>('a.open')];
      expect(links.map((a) => a.textContent?.trim())).toEqual(['열기 ↗', '열기 ↗', '열기 ↗']);
      expect(links[0].getAttribute('href')).toBe('/api/files/00000000-0000-4000-8000-000000000001');
      expect(links[0].target).toBe('_blank');
      expect(el.textContent).not.toContain('운영·회계 담당자만');
    });
  }

  it('disables "열기" for admin and says who may open them', async () => {
    login('admin');
    await open('/users/1?preview', '최초 제출 서류');
    expect(el.querySelectorAll('a.open')).toHaveLength(0);
    const disabled = [...el.querySelectorAll('.open.disabled')];
    expect(disabled).toHaveLength(3);
    expect(disabled.every((d) => d.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(el.querySelector('[role="note"]')?.textContent).toContain(
      '원본은 운영·회계 담당자만 열 수 있어요.',
    );
  });
});
