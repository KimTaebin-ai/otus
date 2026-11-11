import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Component, input } from '@angular/core';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { Role } from '@otus/shared/core/api-types';
import { AuthService } from '../core/auth.service';
import { ReviewState } from '../core/review-state';
import { ReviewStage, SubmissionReview } from './submission-review';
import { PdfSlot } from '../ui/pdf-slot';
import { PdfViewer } from '../ui/pdf-viewer';

@Component({ selector: 'app-pdf-viewer', template: '' })
class PdfViewerStub {
  readonly fileId = input.required<string>();
}

const STEPS: [string, ReviewStage][] = [
  ['', 'review'],
  ['/approve', 'approve'],
  ['/approved', 'approved'],
  ['/revision', 'revision'],
  ['/revision/requested', 'requested'],
];

describe('SubmissionReview route', () => {
  let harness: RouterTestingHarness;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.overrideComponent(PdfSlot, {
      remove: { imports: [PdfViewer] },
      add: { imports: [PdfViewerStub] },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          STEPS.map(([path, stage]) => ({
            path: `submissions/:id${path}`,
            data: { stage },
            component: SubmissionReview,
          })),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  function login(role: Role = 'operator'): void {
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

  function button(text: string): HTMLButtonElement {
    return [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  }

  it('loads the real API without preview and reports a missing submission', async () => {
    login();
    harness = await RouterTestingHarness.create('/submissions/x');
    el = harness.routeNativeElement as HTMLElement;
    expect(el.textContent).toContain('불러오고 있습니다');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/admin/submissions/x')
      .flush(
        { error: { code: 'NOT_FOUND', message: '제출 내역을 찾을 수 없습니다.' } },
        { status: 404, statusText: 'Not Found' },
      );
    harness.detectChanges();
    expect(el.textContent).toContain('제출 내역을 찾을 수 없습니다.');
  });

  it('reviews the 최초 4종: four tabs, the checklist of the open one, the PDF area empty', async () => {
    login();
    await open('/submissions/p?preview', '동민님의 첫 서류를 확인해주세요');
    const tabs = [...el.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.querySelector('strong')?.textContent)).toEqual([
      '신분증',
      '주민등록초본',
      '통장사본',
      '고용보험가입내역서',
    ]);
    expect(tabs[0].textContent).toContain('현재 보는 서류');
    expect(tabs[1].textContent).toContain('PDF 첨부됨');
    expect(el.textContent).toContain('신분증_동민.pdf');
    expect(el.textContent).toContain('PDF · 1.2 MB');
    expect(el.textContent).toContain('제출자와 서류의 이름이 일치해요');
    expect(el.querySelector('app-pdf-viewer')).not.toBeNull();
    expect(el.textContent).toContain('최초 등록 · 서류 4개');
    expect(el.textContent).toContain('2026.09.21 09:41 제출 · 9월 접수 건');
    expect(el.textContent).toContain('동민님이 서류를 제출했어요.');
  });

  it('keeps "4종 승인 검토" off until every tab was opened, and "보완 요청" always on', async () => {
    login();
    await open('/submissions/p?preview', '동민님의 첫 서류');
    expect(button('4종 승인 검토').disabled).toBe(true);
    expect(el.textContent).toContain('아직 확인하지 않은 서류가 3개 있어요.');
    expect(button('보완 요청').disabled).toBe(false);

    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    for (const tab of tabs.slice(1)) {
      tab.click();
      harness.detectChanges();
    }
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(button('4종 승인 검토').disabled).toBe(false);
    });
    expect(el.textContent).toContain('승인 전, 위의 4종 PDF를 모두 살펴봐주세요.');
    // the insurance tab is open: its box and period come from the cycle
    expect(el.textContent).toContain('9월 1일 이후 발급본');
    expect(el.textContent).toContain('제출 기간: 9월 1일 – 9월 30일 23:59');
  });

  it('reviews a monthly submission with one tab that is already "seen"', async () => {
    login();
    await open('/submissions/p?preview=monthly', '동민님의 9월 서류를 확인해주세요');
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(button('승인 검토').disabled).toBe(false);
    expect(el.textContent).toContain('월별 제출 · 서류 1개');
  });

  it('lists the documents on the approve step and marks the ones that were opened', async () => {
    login();
    TestBed.inject(ReviewState).begin('preview-initial');
    TestBed.inject(ReviewState).markViewed('id_card');
    TestBed.inject(ReviewState).markViewed('bankbook');
    await open('/submissions/p/approve?preview', '승인하기 전에 한 번 더 확인해주세요');
    expect(el.textContent).toContain('승인할 서류 4개');
    expect(el.querySelectorAll('.seen')).toHaveLength(2);
    expect(el.textContent).toContain(
      '고용보험가입내역서: 2026.09.19 발급 · 9월 1일 이후 발급 기준 충족',
    );
    expect(button('4종 모두 승인하기')).toBeTruthy();
    expect(el.textContent).toContain('‘서류 승인’으로 바뀌어요');
  });

  it('shows who approved it by role and name', async () => {
    login();
    await open('/submissions/p/approved?preview', '동민님의 서류를 승인했어요');
    expect(el.textContent).toContain('최초 등록 서류 4종 확인 완료');
    expect(el.textContent).toContain('서류 승인');
    expect(el.textContent).toContain('회계·지정 담당자 지우');
    expect(el.textContent).toContain('2026.09.21 10:32');
    expect(el.textContent).toContain('09.21 10:32 · 회계·지정 담당자 지우님이 서류를 승인했어요.');
    expect(el.textContent).toContain('09.21 09:41 · 동민님이 서류를 제출했어요.');
  });

  it('writes a 보완 요청 for several documents: needs one chosen and a reason', async () => {
    login();
    await open('/submissions/p/revision?preview', '동민님께 보완할 내용을 알려주세요');
    const confirm = button('보완 요청 확정');
    expect(confirm.disabled).toBe(true);
    expect(el.textContent).toContain('보완을 요청할 서류를 하나 이상 골라주세요.');

    const rows = [...el.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]')];
    expect(rows).toHaveLength(4);
    rows[3].click();
    harness.detectChanges();
    expect(rows[3].getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('보완 사유를 적어주세요.');

    const area = el.querySelector<HTMLTextAreaElement>('textarea')!;
    area.value = '9월 1일 이후 발급본이 아니에요.';
    area.dispatchEvent(new Event('input'));
    harness.detectChanges();
    expect(button('보완 요청 확정').disabled).toBe(false);
    expect(el.querySelector('.shown')?.textContent).toContain('9월 1일 이후 발급본이 아니에요.');
    expect(el.textContent).toContain('9월 30일 23:59까지 다시 제출해주세요.');
    expect(el.textContent).toContain('2026.09.30 23:59');
    expect(el.textContent).not.toContain('유예');
  });

  it('asks for the one monthly document without a choice', async () => {
    login();
    await open('/submissions/p/revision?preview=monthly', '동민님께 보완할 내용을 알려주세요');
    expect(el.querySelectorAll('.check')).toHaveLength(0);
    expect(el.querySelector('button[role="checkbox"]')?.hasAttribute('disabled')).toBe(true);
    expect(el.querySelector('h3')?.textContent).toContain('고용보험가입내역서');
  });

  it('fills the reason from a ready-made sentence, without overwriting what is written', async () => {
    login();
    await open('/submissions/p/revision?preview=monthly', '보완 사유 · 필수');
    const macros = () => [...el.querySelectorAll<HTMLButtonElement>('.macro')];
    // the chosen document's sentences come first, then the common ones
    expect(macros()[0].textContent).toContain('발급일이 1일 이전');
    const area = () => el.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(area().value).toBe('');

    macros()[0].click();
    harness.detectChanges();
    expect(area().value).toContain('해당 월 1일 이후에 발급한 고용보험가입내역서를 올려주세요.');
    expect(button('보완 요청 확정').disabled).toBe(false);
    expect(el.querySelector('.shown')?.textContent).toContain('1일 이후에 발급한');
    // already in: it cannot be added twice
    expect(macros()[0].disabled).toBe(true);
    expect(macros()[0].getAttribute('aria-pressed')).toBe('true');

    const before = area().value;
    const another = macros().find((m) => m.textContent?.includes('흐리거나'))!;
    another.click();
    harness.detectChanges();
    expect(area().value.startsWith(before + '\n')).toBe(true);
    expect(area().value).toContain('선명하게 다시 스캔');
  });

  it("opens the student's 42 Intra profile from the study-hours box on the review page", async () => {
    login();
    await open('/submissions/p?preview', '이 교육생의 학습 시간');
    const link = el.querySelector<HTMLAnchorElement>('a.hours')!;
    expect(link.getAttribute('href')).toMatch(/^https:\/\/profile\.intra\.42\.fr\/users\/[\w.-]+$/);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.textContent).toContain('인트라에서 직접 확인하기');
  });

  it('caps the reason at 1000 characters', async () => {
    login();
    await open('/submissions/p/revision?preview=monthly', '보완 사유 · 필수');
    expect(el.querySelector('textarea')?.getAttribute('maxlength')).toBe('1000');
  });

  it('shows the result of a request with the reason as the student sees it', async () => {
    login();
    await open('/submissions/p/revision/requested?preview=monthly', '동민님께 보완을 요청했어요');
    expect(el.textContent).toContain('2026년 9월 · 보완 대상 서류 1개');
    expect(el.textContent).toContain('새 파일을 기다리고 있어요');
    expect(el.textContent).toContain('운영 담당자 지우 · 2026.09.21 10:32');
    expect(el.textContent).toContain('2026.09.30 23:59');
    expect(el.textContent).toContain('서류 일부가 흐릿해서');
    expect(el.textContent).toContain('재검토 요청');
  });

  it('lets operator download the original', async () => {
    login('operator');
    await open('/submissions/p?preview', '신분증_동민.pdf');
    expect(el.querySelector('a.download')?.getAttribute('href')).toBe(
      '/api/files/00000000-0000-4000-8000-0000000000a1',
    );
  });

  it('disables the download for admin and says who may open originals', async () => {
    login('admin');
    await open('/submissions/p?preview', '신분증_동민.pdf');
    expect(el.querySelector('a.download')).toBeNull();
    expect(el.querySelector('.download.disabled')?.getAttribute('aria-disabled')).toBe('true');
    expect(el.textContent).toContain('원본은 운영·회계 담당자만 열 수 있어요.');
  });
});
