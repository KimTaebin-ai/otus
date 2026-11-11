import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';

import { Me, Role } from '@otus/shared/core/api-types';
import { forbiddenGuard, guestGuard, landingPath, menuGuard, staffGuard } from './guards';

const me = (role: Role): Me => ({
  id: 1,
  login: 'jiwoo',
  display_name: '지우',
  role,
  is_demo: true,
  study_hours: 0,
  employed: false,
  employment_updated_at: null,
  initial_submitted: false,
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
  async function run(guard: CanActivateFn, response: Me | null, url = '/'): Promise<string | true> {
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
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
    return value instanceof UrlTree ? TestBed.inject(Router).serializeUrl(value) : true;
  }

  it('landingPath sends each kind of user to its place', () => {
    expect(landingPath(null)).toBe('/login');
    expect(landingPath(me('student'))).toBe('/forbidden');
    expect(landingPath(me('operator'))).toBe('/');
    expect(landingPath(me('accountant'))).toBe('/');
    expect(landingPath(me('admin'))).toBe('/');
  });

  describe('staffGuard', () => {
    it('sends a logged-out user to /login', async () => {
      expect(await run(staffGuard, null)).toBe('/login');
    });

    it('sends a student to /forbidden', async () => {
      expect(await run(staffGuard, me('student'))).toBe('/forbidden');
    });

    for (const role of ['operator', 'accountant', 'admin'] as const) {
      it(`lets ${role} in`, async () => {
        expect(await run(staffGuard, me(role))).toBe(true);
      });
    }
  });

  describe('guestGuard', () => {
    it('lets a logged-out user see the login page', async () => {
      expect(await run(guestGuard, null)).toBe(true);
    });

    it('sends staff to /', async () => {
      expect(await run(guestGuard, me('accountant'))).toBe('/');
    });

    it('sends a student to /forbidden', async () => {
      expect(await run(guestGuard, me('student'))).toBe('/forbidden');
    });
  });

  describe('forbiddenGuard', () => {
    it('shows the page to a student only', async () => {
      expect(await run(forbiddenGuard, me('student'))).toBe(true);
    });

    it('sends a logged-out user to /login', async () => {
      expect(await run(forbiddenGuard, null)).toBe('/login');
    });

    it('sends staff to /', async () => {
      expect(await run(forbiddenGuard, me('operator'))).toBe('/');
    });
  });

  describe('menuGuard', () => {
    it('lets a role through to a screen whose menu item lists it', async () => {
      expect(await run(menuGuard, me('operator'), '/users/3')).toBe(true);
    });

    it('lets any staff through to a URL that is not a menu item', async () => {
      expect(await run(menuGuard, me('admin'), '/somewhere')).toBe(true);
    });

    it('sends a role the menu item does not list to /', async () => {
      expect(await run(menuGuard, me('student'), '/users')).toBe('/');
    });
  });
});
