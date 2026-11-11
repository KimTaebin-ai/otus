import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { Cycle, Submission } from '../core/api.models';
import { InitialRevision } from './initial-revision';

const cycle: Cycle = {
  target_month: '2026-10',
  state: 'open',
  opens_at: '2026-10-01T00:00:00+09:00',
  closes_at: '2026-11-01T00:00:00+09:00',
  d_day: 15,
  issued_after: '2026-10-01',
};

const uploaded_at = '2026-09-21T09:40:00+09:00';
const initial: Submission = {
  id: 'i-1',
  kind: 'initial',
  target_month: '2026-09',
  status: 'revision_requested',
  parent_id: null,
  submitted_at: '2026-09-21T09:41:00+09:00',
  review_comment: '신분증이 흐릿해요. 통장사본은 계좌가 달라요.',
  required_doc_types: ['id_card', 'resident_abstract', 'bankbook', 'employment_insurance'],
  files: [
    { file_id: 'f-1', doc_type: 'id_card', original_name: '신분증_동민.pdf', size: 1, uploaded_at },
    {
      file_id: 'f-3',
      doc_type: 'bankbook',
      original_name: '통장사본_동민.pdf',
      size: 1,
      uploaded_at,
    },
  ],
  created_at: '2026-09-21T09:40:00+09:00',
};
// the draft the API returns: only the documents the reviewer asked for
const draft: Submission = {
  ...initial,
  id: 's-1',
  kind: 'supplement',
  status: 'draft',
  parent_id: 'i-1',
  submitted_at: null,
  review_comment: null,
  required_doc_types: ['id_card', 'bankbook'],
  files: [],
};

describe('InitialRevision (/submit/initial)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function open(items: Submission[]) {
    const fixture = TestBed.createComponent(InitialRevision);
    fixture.detectChanges();
    http.expectOne('/api/cycles/current').flush(cycle);
    http.expectOne('/api/submissions').flush({ items });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('asks for the documents the reviewer picked, for a month that is not the cycle month', async () => {
    const fixture = await open([initial]);
    const create = http.expectOne('/api/submissions');
    expect(create.request.body).toEqual({
      kind: 'supplement',
      target_month: '2026-09',
      parent_id: 'i-1',
    });
    create.flush(draft);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('서류 2개를 보완해주세요');
    expect(el.querySelectorAll('app-upload-slot')).toHaveLength(2);
    expect(el.textContent).toContain('신분증, 통장사본을 다시 올려주세요');
    expect(el.textContent).toContain('신분증이 흐릿해요. 통장사본은 계좌가 달라요.');
    expect(el.textContent).toContain('신분증_동민.pdf');
    // the issue-date rule is the 고용보험가입내역서's only
    expect(el.textContent).not.toContain('이후에 발급된');
  });

  it('goes home when no request is waiting', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await open([{ ...initial, status: 'pending_review' }]);
    expect(navigate).toHaveBeenCalledWith('/home');
  });
});
