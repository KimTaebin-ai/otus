import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Users } from './users';

const ITEM = (id: number, login = `u${id}`) => ({
  id,
  login,
  display_name: `이름${id}`,
  employed: id % 2 === 0,
  initial_submitted: true,
});

/** dongmin as the search API returns him: Korean name in ko_name, short name in display_name */
const DONGMIN = {
  id: 7,
  login: 'dongmin',
  display_name: '동민',
  ko_name: '김동민',
  ordinal: '5',
  date_of_birth: '2001-03-14',
  employed: false,
  initial_submitted: true,
};

describe('Users list (GET /api/admin/users)', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'users', component: Users }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create('/users');
    el = harness.routeNativeElement as HTMLElement;
  });

  const first = () =>
    http.expectOne((r) => r.url === '/api/admin/users' && !r.params.has('before'));

  it('asks for the first page and lists the users, each linking to its A18', async () => {
    const req = first();
    expect(req.request.params.get('limit')).toBe('20');
    expect(req.request.params.has('query')).toBe(false);
    req.flush({ items: [ITEM(3), ITEM(2)], next_before: null });
    harness.detectChanges();
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('이름3');
    expect(rows[0].textContent).toContain('미취업');
    expect(rows[1].textContent).toContain('취업 중');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/users/3');
    expect(el.textContent).toContain('교육생 2명');
    expect(el.textContent).not.toContain('더 보기');
  });

  it('loads the next page with `before` when the list box is scrolled to its bottom', async () => {
    first().flush({ items: [ITEM(3), ITEM(2)], next_before: 2 });
    harness.detectChanges();
    expect(el.textContent).toContain('교육생 2명 이상');
    expect(el.textContent).not.toContain('더 보기');
    const box = el.querySelector<HTMLElement>('.scroll')!;
    // a window scroll elsewhere on the page does not ask for more
    window.dispatchEvent(new Event('scroll'));
    http.expectNone((r) => r.params.get('before') === '2');
    // happy-dom has no layout: pretend the box is 100px tall with 400px of rows, scrolled to the end
    Object.defineProperties(box, {
      clientHeight: { value: 100, configurable: true },
      scrollHeight: { value: 400, configurable: true },
      scrollTop: { value: 300, configurable: true },
    });
    box.dispatchEvent(new Event('scroll'));
    const req = http.expectOne((r) => r.params.get('before') === '2');
    req.flush({ items: [ITEM(1)], next_before: null });
    harness.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('searches after a pause with the trimmed text', async () => {
    first().flush({ items: [ITEM(3)], next_before: null });
    harness.detectChanges();
    vi.useFakeTimers();
    try {
      const input = el.querySelector<HTMLInputElement>('input[type=search]')!;
      input.value = ' 동민 ';
      input.dispatchEvent(new Event('input'));
      harness.detectChanges();
      await vi.advanceTimersByTimeAsync(100);
      http.expectNone((r) => r.params.has('query'));
      await vi.advanceTimersByTimeAsync(300);
      const req = http.expectOne((r) => r.params.get('query') === '동민');
      req.flush({ items: [], next_before: null });
    } finally {
      vi.useRealTimers();
    }
    harness.detectChanges();
    expect(el.textContent).toContain('"동민"에 맞는 교육생이 없어요.');
  });

  it('finds a student by partial intra ID and by partial Korean name, showing both identifiers', async () => {
    first().flush({ items: [ITEM(3)], next_before: null });
    harness.detectChanges();
    // the same student must be reachable both ways, and the row must carry the
    // Korean name and the intra ID together so same-name students stay apart
    for (const typed of ['dong', '김동']) {
      vi.useFakeTimers();
      try {
        const input = el.querySelector<HTMLInputElement>('input[type=search]')!;
        input.value = typed;
        input.dispatchEvent(new Event('input'));
        harness.detectChanges();
        await vi.advanceTimersByTimeAsync(300);
        const req = http.expectOne((r) => r.params.get('query') === typed);
        req.flush({ items: [DONGMIN], next_before: null });
      } finally {
        vi.useRealTimers();
      }
      harness.detectChanges();
      const rows = [...el.querySelectorAll('tbody tr')];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('김동민');
      expect(rows[0].textContent).toContain('dongmin');
      expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/users/7');
    }
  });

  it('shows the server message when the request fails', async () => {
    first().flush(
      { error: { code: 'FORBIDDEN', message: '권한이 없습니다.' } },
      { status: 403, statusText: 'Forbidden' },
    );
    harness.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('권한이 없습니다.');
  });
});
