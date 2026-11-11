import { ArchiveRow } from './admin.models';
import { planArchive } from './archive-plan';

function row(
  userId: number,
  name: string,
  login: string,
  over: Partial<ArchiveRow> = {},
): ArchiveRow {
  return {
    userId,
    name,
    login,
    files: ['employment_insurance'],
    baseDocs: ['id_card', 'resident_abstract', 'bankbook'],
    previous: [],
    submittedAt: '2026-09-21T09:12:00+09:00',
    status: 'pending_review',
    kinds: ['monthly'],
    ...over,
  };
}

const NONE = { baseDocs: false, previous: false };

describe('planArchive', () => {
  it('puts only the final submissions in by default', () => {
    const plan = planArchive('2026-09', [row(1, '동민', 'dongkim2')], NONE);
    expect(plan.root).toBe('2026년 9월');
    expect(plan.zipName).toBe('2026년 9월_지원금 자료.zip');
    expect(plan.csvName).toBe('제출목록.csv');
    expect(plan.students).toEqual([
      {
        userId: 1,
        name: '동민',
        login: 'dongkim2',
        folder: '동민_dongkim2',
        files: ['9월_고용보험.pdf'],
      },
    ]);
    expect(plan.pdfCount).toBe(1);
  });

  it('adds the approved base documents only when asked', () => {
    const rows = [row(1, '동민', 'dongkim2')];
    const plan = planArchive('2026-09', rows, { baseDocs: true, previous: false });
    expect(plan.students[0].files).toEqual([
      '9월_고용보험.pdf',
      '기본서류_신분증.pdf',
      '기본서류_주민등록초본.pdf',
      '기본서류_통장사본.pdf',
    ]);
    expect(plan.pdfCount).toBe(4);
  });

  it('does not add a base document the submission already has (최초 4종)', () => {
    const initial = row(1, '정하늘', 'haneul', {
      files: ['id_card', 'resident_abstract', 'bankbook', 'employment_insurance'],
    });
    const plan = planArchive('2026-09', [initial], { baseDocs: true, previous: false });
    expect(plan.students[0].files).toHaveLength(4);
    expect(plan.students[0].files).not.toContain('기본서류_통장사본.pdf');
  });

  it('adds the older versions only when asked, and numbers repeats', () => {
    const r = row(1, '동민', 'dongkim2', {
      previous: ['employment_insurance', 'employment_insurance'],
    });
    expect(planArchive('2026-09', [r], NONE).students[0].files).toEqual(['9월_고용보험.pdf']);
    expect(
      planArchive('2026-09', [r], { baseDocs: false, previous: true }).students[0].files,
    ).toEqual(['9월_고용보험.pdf', '이전제출본_9월_고용보험.pdf', '이전제출본_9월_고용보험_2.pdf']);
  });

  it('keeps student folders apart when names collapse to the same text', () => {
    const plan = planArchive(
      '2026-09',
      [row(1, 'A/B', 'x'), row(2, 'A:B', 'x'), row(3, 'a/b', 'X')],
      NONE,
    );
    expect(plan.students.map((s) => s.folder)).toEqual(['A_B_x', 'A_B_x_2', 'a_b_X_3']);
  });

  it('plans nothing for no rows', () => {
    const plan = planArchive('2026-09', [], NONE);
    expect(plan.students).toEqual([]);
    expect(plan.pdfCount).toBe(0);
  });
});
