import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { AuthMethods } from '@otus/shared/core/api-types';
import { Login } from './login';

describe('Login', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function render(methods: AuthMethods): HTMLElement {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/auth/methods').flush(methods);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the 42 login and the demo login when both are on', () => {
    const el = render({ forty_two: true, demo: true });
    expect(el.textContent).toContain('42 계정으로 로그인');
    expect(el.querySelector('#demo-login')).not.toBeNull();
  });

  it('shows only the 42 login when demo login is off (production)', () => {
    const el = render({ forty_two: true, demo: false });
    expect(el.textContent).toContain('42 계정으로 로그인');
    expect(el.querySelector('#demo-login')).toBeNull();
    expect(el.textContent).not.toContain('사용할 수 있는 로그인 방법이 없어요');
  });

  it('shows only the demo login when 42 is not configured', () => {
    const el = render({ forty_two: false, demo: true });
    expect(el.textContent).not.toContain('42 계정으로 로그인');
    expect(el.querySelector('#demo-login')).not.toBeNull();
  });

  it('says so when no login method is enabled', () => {
    const el = render({ forty_two: false, demo: false });
    expect(el.textContent).toContain('사용할 수 있는 로그인 방법이 없어요');
  });

  it('shows the staff_only reason from the 42 callback', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap({ error: 'staff_only' }) } },
    });
    const el = render({ forty_two: true, demo: false });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('관리자 계정이 아니에요');
  });
});
