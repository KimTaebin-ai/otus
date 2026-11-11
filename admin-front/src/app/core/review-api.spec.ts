import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ReviewApi, ReviewNavigation } from './review-api';

describe('review user navigation', () => {
  let http: HttpTestingController;
  let api: ReviewApi;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ReviewApi);
  });
  afterEach(() => http.verify());

  it('skips another submission from the current user in either direction', () => {
    let result: ReviewNavigation | undefined;
    api.userNavigation('current', '2026-10', 7).subscribe((value) => (result = value));
    http
      .expectOne('/api/admin/submissions/current/navigation?month=2026-10')
      .flush({ previous_id: 'same-before', next_id: 'same-after', remaining_count: 4 });
    http.expectOne('/api/admin/submissions/same-before').flush({ user: { id: 7 } });
    http.expectOne('/api/admin/submissions/same-after').flush({ user: { id: 7 } });
    http
      .expectOne('/api/admin/submissions/same-before/navigation?month=2026-10')
      .flush({ previous_id: 'other-before', next_id: 'current', remaining_count: 4 });
    http
      .expectOne('/api/admin/submissions/same-after/navigation?month=2026-10')
      .flush({ previous_id: 'current', next_id: 'other-after', remaining_count: 4 });
    http.expectOne('/api/admin/submissions/other-before').flush({ user: { id: 6 } });
    http.expectOne('/api/admin/submissions/other-after').flush({ user: { id: 8 } });
    expect(result).toEqual({
      previous_id: 'other-before',
      next_id: 'other-after',
      remaining_count: 4,
    });
  });

  it('disables the neighbor when the only remaining submission belongs to the current user', () => {
    let result: ReviewNavigation | undefined;
    api.userNavigation('current', '2026-10', 7).subscribe((value) => (result = value));
    http
      .expectOne('/api/admin/submissions/current/navigation?month=2026-10')
      .flush({ previous_id: null, next_id: 'same', remaining_count: 1 });
    http.expectOne('/api/admin/submissions/same').flush({ user: { id: 7 } });
    http
      .expectOne('/api/admin/submissions/same/navigation?month=2026-10')
      .flush({ previous_id: 'current', next_id: null, remaining_count: 1 });
    expect(result).toEqual({ previous_id: null, next_id: null, remaining_count: 1 });
  });
});
