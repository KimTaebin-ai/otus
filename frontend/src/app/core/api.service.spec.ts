import { HttpErrorResponse, HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ApiService, errorMessage } from './api.service';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uploads doc_type before the file, as multipart', () => {
    const file = new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' });
    const events: HttpEventType[] = [];
    api.uploadFile('s-1', 'bankbook', file).subscribe((e) => events.push(e.type));

    const req = http.expectOne('/api/submissions/s-1/files');
    expect(req.request.method).toBe('POST');
    expect(req.request.reportProgress).toBe(true);
    const body = req.request.body as FormData;
    expect([...body.keys()]).toEqual(['doc_type', 'file']);
    expect(body.get('doc_type')).toBe('bankbook');
    req.flush({});
    expect(events).toContain(HttpEventType.Response);
  });

  it('sends the Idempotency-Key on finalize', () => {
    api.finalize('s-1', 'k-1').subscribe();
    const req = http.expectOne('/api/submissions/s-1/finalize');
    expect(req.request.headers.get('Idempotency-Key')).toBe('k-1');
    req.flush({});
  });

  it('skips undefined list query params', () => {
    api.listSubmissions({ limit: 3, month: undefined }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/submissions');
    expect(req.request.params.keys()).toEqual(['limit']);
    expect(req.request.params.get('limit')).toBe('3');
    req.flush({ items: [] });
  });

  it('reads time requirements with an optional limit', () => {
    api.timeRequirements({ limit: 2 }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/me/time-requirements');
    expect(req.request.params.get('limit')).toBe('2');
    req.flush({ items: [] });
  });

  it('omits an empty display_name on demo login', () => {
    api.demoLogin('dongmin', '').subscribe();
    const req = http.expectOne('/api/auth/demo-login');
    expect(req.request.body).toEqual({ login: 'dongmin', display_name: undefined });
    req.flush({});
  });

  it('errorMessage reads the api.md error body', () => {
    const err = new HttpErrorResponse({
      status: 422,
      error: { error: { code: 'CYCLE_CLOSED', message: '접수 기간이 아닙니다.' } },
    });
    expect(errorMessage(err)).toBe('접수 기간이 아닙니다.');
    expect(errorMessage(new HttpErrorResponse({ status: 0 }))).toBe('서버에 연결할 수 없습니다.');
    expect(errorMessage(new HttpErrorResponse({ status: 413, error: '' }))).toBe(
      '파일 용량이 너무 큽니다.',
    );
  });
});
