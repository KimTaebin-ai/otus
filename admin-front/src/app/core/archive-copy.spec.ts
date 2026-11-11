import { ArchiveRow, ArchiveView } from './admin.models';
import { planArchive } from './archive-plan';
import {
  archiveDescription,
  archiveNotice,
  archiveTitle,
  blockedReason,
  contentParts,
  downloadHeading,
  downloadLabel,
  downloadRows,
  folderRows,
  helpCards,
  optionsNotice,
  planSummary,
  filesSummary,
  folderNote,
  receivedAt,
  tableHeading,
} from './archive-copy';

function row(userId: number, files: ArchiveRow['files']): ArchiveRow {
  return {
    userId,
    name: '동민',
    login: 'dongkim2',
    files,
    baseDocs: [],
    previous: [],
    submittedAt: '2026-09-21T09:12:00+09:00',
    status: 'pending_review',
    kinds: ['monthly'],
  };
}

describe('archive copy', () => {
  it('names the month', () => {
    expect(archiveTitle('2026-09')).toBe('9월 자료함');
    expect(archiveTitle('2026-12')).toBe('12월 자료함');
    expect(archiveDescription('2026-09')).toContain('2026년 9월');
  });

  it('counts the originals of every row, drafts are not rows', () => {
    const view: ArchiveView = {
      month: '2026-09',
      months: ['2026-09'],
      rows: [row(1, ['employment_insurance']), row(2, ['employment_insurance', 'bankbook'])],
    };
    expect(archiveNotice(view).heading).toBe('접수된 원본 3개가 안전하게 보관되어 있어요');
    expect(archiveNotice(view).body).toContain('임시 저장');
  });

  it('writes the headings and the button', () => {
    expect(tableHeading('2026-09', 3, 2)).toBe('9월 자료 · 3명 중 2명 선택');
    expect(downloadLabel(3)).toBe('선택한 3명 내려받기');
  });

  it('summarizes the files of a row', () => {
    expect(filesSummary(['employment_insurance'])).toBe('고용보험 1개');
    expect(filesSummary(['id_card', 'bankbook'])).toBe('신분증 + 통장사본 2개');
    expect(filesSummary(['id_card', 'resident_abstract', 'bankbook', 'employment_insurance'])).toBe(
      '최초 4종',
    );
  });

  it('shows the receipt time in KST as written by the server', () => {
    expect(receivedAt('2026-09-21T09:12:00+09:00')).toBe('09.21 09:12');
  });

  it('counts only the selected rows in the folder note', () => {
    const rows = [row(1, ['employment_insurance']), row(2, ['id_card', 'bankbook'])];
    expect(folderNote(rows, new Set([2]))[0]).toContain('2개');
    expect(folderNote(rows, new Set())[0]).toContain('0개');
  });
});

describe('A13 and A14 copy', () => {
  const rows = [row(1, ['employment_insurance']), row(2, ['employment_insurance'])];
  const none = { baseDocs: false, previous: false };
  const plan = planArchive('2026-09', rows, none);

  it('lists what the ZIP holds, in order', () => {
    expect(contentParts(none)).toEqual(['이번 달 최종 제출본', '제출 목록']);
    expect(contentParts({ baseDocs: true, previous: true })).toEqual([
      '이번 달 최종 제출본',
      '기본 서류 3종',
      '이전 제출본',
      '제출 목록',
    ]);
  });

  it('calls the default the 기본 설정 and any change the 선택한 구성', () => {
    expect(optionsNotice(plan, none).heading).toBe('기본 설정 · 이번 달 최종 제출본 + 제출 목록');
    expect(optionsNotice(plan, none).body).toContain('2명의 PDF 2개');
    expect(optionsNotice(plan, { baseDocs: true, previous: false }).heading).toBe(
      '선택한 구성 · 이번 달 최종 제출본 + 기본 서류 3종 + 제출 목록',
    );
  });

  it('previews one row per folder and ends with the 제출목록.csv in the root', () => {
    const preview = folderRows(plan);
    expect(preview).toHaveLength(3);
    expect(preview[0]).toEqual({
      folder: '2026년 9월 / 동민_dongkim2',
      files: '9월_고용보험.pdf',
    });
    expect(preview[1].folder).toBe('2026년 9월 / 동민_dongkim2_2');
    expect(preview[2]).toEqual({
      folder: '2026년 9월',
      files: '제출목록.csv · 엑셀에서 열 수 있어요',
    });
  });

  it('says what happened to the download', () => {
    expect(downloadHeading('ready').heading).toBe('다운로드를 시작했어요');
    expect(downloadHeading('creating').heading).toContain('만들고 있어요');
    expect(downloadHeading('failed').heading).toContain('만들지 못했어요');
  });

  it('summarizes the ZIP and the configuration', () => {
    expect(planSummary(plan)).toBe('교육생 2명 · PDF 2개 + 제출 목록');
    const table = downloadRows(plan, { baseDocs: true, previous: false });
    expect(table.map((r) => r.label)).toEqual(['교육생 폴더', '포함 자료', '제출 목록']);
    expect(table[0].value).toBe('동민_dongkim2 · 동민_dongkim2_2');
    expect(table[1].value).toBe('이번 달 최종 제출본 · 기본 서류 3종');
    expect(helpCards(plan)[0].lines[0]).toBe('자료함 → 2026년 9월');
    expect(helpCards(plan)).toHaveLength(2);
  });

  it('blocks the page for other roles and for an empty selection', () => {
    expect(blockedReason(false, 3)).toContain('회계·지정 담당자');
    expect(blockedReason(true, 0)).toContain('선택한 교육생이 없어요');
    expect(blockedReason(true, 2)).toBeNull();
  });
});
