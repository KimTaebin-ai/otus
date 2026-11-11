import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { Login } from './login';

function setup(query: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(Login);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  const el = fixture.nativeElement as HTMLElement;
  const button = () => el.querySelector('button.login') as HTMLButtonElement;
  return { fixture, http, el, button };
}

describe('Login (U01)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows why the 42 login failed', () => {
    const { el, http } = setup({ error: 'not_campus_member' });
    http.expectOne('/api/auth/methods').flush({ forty_two: true, demo: false });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('42 경산 캠퍼스');
  });

  it('keeps the button disabled until the login methods are known', async () => {
    const { fixture, http, button } = setup();
    expect(button().disabled).toBe(true);
    http.expectOne('/api/auth/methods').flush({ forty_two: true, demo: false });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(button().disabled).toBe(false);
  });

  it('goes to 42 OAuth when the server has it', async () => {
    const { fixture, http, button } = setup();
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign });
    http.expectOne('/api/auth/methods').flush({ forty_two: true, demo: true });
    fixture.detectChanges();
    await fixture.whenStable();
    button().click();
    expect(assign).toHaveBeenCalledWith('/api/auth/42/login');
    http.expectNone('/api/auth/demo-login');
  });

  it('without 42 OAuth the 42 button fails visibly instead of demo-logging in as dongmin', async () => {
    const { fixture, http, button, el } = setup();
    http.expectOne('/api/auth/methods').flush({ forty_two: false, demo: true });
    fixture.detectChanges();
    await fixture.whenStable();
    button().click();
    http.expectNone('/api/auth/demo-login');
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('42 로그인이 설정되어 있지 않아요');
  });

  it('?demo= still forces the demo login for testing', async () => {
    const { fixture, http, button } = setup({ demo: 'seoyeon' });
    http.expectOne('/api/auth/methods').flush({ forty_two: true, demo: true });
    fixture.detectChanges();
    await fixture.whenStable();
    button().click();
    expect(http.expectOne('/api/auth/demo-login').request.body.login).toBe('seoyeon');
  });

  it('the demo field logs in with the typed ID, and only exists when demo is on', async () => {
    const { fixture, http, el } = setup();
    http.expectOne('/api/auth/methods').flush({ forty_two: false, demo: true });
    fixture.detectChanges();
    await fixture.whenStable();
    const input = el.querySelector('#demo-login') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'case03';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('.demo button') as HTMLButtonElement).click();
    expect(http.expectOne('/api/auth/demo-login').request.body.login).toBe('case03');

    TestBed.resetTestingModule();
    const off = setup();
    off.http.expectOne('/api/auth/methods').flush({ forty_two: true, demo: false });
    off.fixture.detectChanges();
    await off.fixture.whenStable();
    expect(off.el.querySelector('#demo-login')).toBeNull();
  });
});
