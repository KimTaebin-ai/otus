import { REVIEW_MONTHLY_PREVIEW, REVIEW_PREVIEW } from '../dev/preview-data';
import {
  approveHint,
  approveReviewLabel,
  approvedBanner,
  checklist,
  confirmApproveLabel,
  dueSentence,
  eventLine,
  issuedBox,
  issuedCheck,
  kindSummary,
  reasonProblem,
  resubmitDue,
  revisionBlocker,
  reviewDescription,
  reviewTitle,
  submittedSummary,
} from './review-copy';

describe('review copy', () => {
  const initial = REVIEW_PREVIEW;
  const monthly = REVIEW_MONTHLY_PREVIEW;

  it('words the initial and monthly reviews apart', () => {
    expect(reviewTitle(initial)).toBe('동민님의 첫 서류를 확인해주세요');
    expect(reviewTitle(monthly)).toBe('동민님의 9월 서류를 확인해주세요');
    expect(reviewDescription(initial)).toContain('4종의 PDF');
    expect(approveReviewLabel(initial)).toBe('4종 승인 검토');
    expect(approveReviewLabel(monthly)).toBe('승인 검토');
    expect(confirmApproveLabel(initial)).toBe('4종 모두 승인하기');
    expect(confirmApproveLabel(monthly)).toBe('승인 확정하기');
    expect(kindSummary(initial)).toBe('최초 등록 · 서류 4개');
    expect(kindSummary(monthly)).toBe('최초 등록 · 서류 1개'.replace('최초 등록', '월별 제출'));
    expect(submittedSummary(initial)).toBe('2026.09.21 09:41 제출 · 9월 접수 건');
  });

  it('says how many documents are still unopened before it asks for approval', () => {
    expect(approveHint(initial, 3)).toBe('아직 확인하지 않은 서류가 3개 있어요.');
    expect(approveHint(initial, 0)).toBe('승인 전, 위의 4종 PDF를 모두 살펴봐주세요.');
    expect(approveHint(monthly, 0)).toBe('승인 전, 위의 PDF를 살펴봐주세요.');
  });

  it('takes the period from the cycle: starts on the 1st, ends with lastMoment', () => {
    expect(issuedBox(initial)).toEqual({
      title: '9월 1일 이후 발급본',
      period: '제출 기간: 9월 1일 – 9월 30일 23:59',
    });
    expect(resubmitDue(initial)).toBe('2026.09.30 23:59');
    expect(dueSentence(initial)).toBe('9월 30일 23:59까지 다시 제출해주세요.');
  });

  it('checks the insurance issue date against the first of the month', () => {
    expect(issuedCheck(initial)).toBe(
      '고용보험가입내역서: 2026.09.19 발급 · 9월 1일 이후 발급 기준 충족',
    );
    const early = {
      ...monthly,
      docs: [{ ...monthly.docs[0], issuedOn: '2026-08-31' }],
    };
    expect(issuedCheck(early)).toContain('기준 미충족');
    expect(issuedCheck({ ...initial, docs: [initial.docs[0]] })).toBeNull();
  });

  it('has three checks per document and puts the student and month into them', () => {
    for (const doc of initial.docs) {
      expect(checklist(doc.docType, initial.month, initial.name).lines).toHaveLength(3);
    }
    expect(checklist('bankbook', '2026-09', '동민').lines[0]).toBe('예금주가 동민님과 일치해요');
    expect(checklist('employment_insurance', '2026-09', '동민').lines[1]).toBe(
      '9월 1일 이후에 발급된 서류예요',
    );
  });

  it('requires a reason of 1 to 1000 characters and one document', () => {
    expect(reasonProblem('   ')).toBe('empty');
    expect(reasonProblem('가'.repeat(1000))).toBeNull();
    expect(reasonProblem('가'.repeat(1001))).toBe('too_long');
    expect(revisionBlocker(0, '사유')).toContain('서류를 하나 이상');
    expect(revisionBlocker(1, ' ')).toBe('보완 사유를 적어주세요.');
    expect(revisionBlocker(1, '흐릿해요')).toBeNull();
  });

  it('names the staff member who handled it, by role and name', () => {
    expect(
      eventLine({
        at: '2026-09-21T10:32:00+09:00',
        action: 'approved',
        actor: { name: '지우', role: 'operator' },
      }),
    ).toEqual({ when: '09.21 10:32', text: '운영 담당자 지우님이 서류를 승인했어요.' });
    expect(eventLine(initial.events[0]).text).toBe('동민님이 서류를 제출했어요.');
    expect(approvedBanner(initial)).toBe('최초 등록 서류 4종 확인 완료');
    expect(approvedBanner(monthly)).toBe('9월 고용보험가입내역서 확인 완료');
  });

  it('keeps the policy out: no grace period wording, no fixed dates, no mixing with 수령 대상', () => {
    const all = [
      reviewTitle(initial),
      reviewDescription(initial),
      issuedBox(initial).period,
      dueSentence(initial),
      ...initial.docs.flatMap((d) => checklist(d.docType, initial.month, initial.name).lines),
    ].join(' ');
    expect(all).not.toContain('유예');
    expect(all).not.toContain('9월 21일');
    expect(all).not.toContain('수령 대상');
  });
});
