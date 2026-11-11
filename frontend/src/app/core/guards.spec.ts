import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';

import { Me } from './api.models';
import {
  authGuard,
  guestGuard,
  initialPendingGuard,
  initialSubmittedGuard,
  landingFor,
  landingPath,
} from './guards';

const me = (initial_submitted: boolean): Me => ({
  id: 1,
  login: 'dongmin',
  display_name: '동민',
  role: 'student',
  is_demo: true,
  study_hours: 0,
  employed: false,
  employment_updated_at: null,
  initial_submitted,
});

describe('guards', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Runs a guard while answering its /api/me request with `response` (null = 401). */
  async function run(guard: typeof authGuard, response: Me | null): Promise<string | true> {
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;
    const pending = firstValueFrom(result);
    const req = http.expectOne('/api/me');
    if (response) {
      req.flush(response);
    } else {
      req.flush(
        { error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    }
    const value = await pending;
    return value === true ? true : TestBed.inject(Router).serializeUrl(value as UrlTree);
  }

  it('U01 branching sends users without 최초 4종 to U02', () => {
    expect(landingPath(false)).toBe('/initial');
    expect(landingPath(true)).toBe('/home');
  });

  it('authGuard sends logged-out users to /login', async () => {
    expect(await run(authGuard, null)).toBe('/login');
  });

  it('authGuard lets logged-in users through', async () => {
    expect(await run(authGuard, me(false))).toBe(true);
  });

  it('initialSubmittedGuard sends users without 최초 4종 to /initial', async () => {
    expect(await run(initialSubmittedGuard, me(false))).toBe('/initial');
  });

  it('initialPendingGuard sends users who already submitted to /home', async () => {
    expect(await run(initialPendingGuard, me(true))).toBe('/home');
  });

  it('guestGuard sends logged-in users to their landing page', async () => {
    expect(await run(guestGuard, me(true))).toBe('/home');
  });
});

describe('landingFor with the profile step', () => {
  const base = { ...me(false), ko_name: '홍길동', date_of_birth: '2003-04-21' };

  it('asks for the profile first, then sends users to 최초 4종', () => {
    expect(landingFor(me(false))).toBe('/profile');
    expect(landingFor({ ...base, ordinal: '3A' })).toBe('/initial');
  });

  it('sends 지원금 지급 종료 and 트랜스퍼 교육생 to /hello instead of 최초 4종', () => {
    expect(landingFor({ ...base, ordinal: 'ended' })).toBe('/hello');
    expect(landingFor({ ...base, ordinal: 'transfer' })).toBe('/hello');
  });

  it('sends users who already submitted to home', () => {
    expect(landingFor({ ...base, ordinal: 'ended', initial_submitted: true })).toBe('/home');
  });
});
