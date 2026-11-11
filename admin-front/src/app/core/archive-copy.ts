import { DocType } from '@otus/shared/core/api-types';
import { dotMonthDay, hourMinute, monthNumber } from '@otus/shared/core/format';
import {
  ArchiveCriteria,
  ArchiveOptions,
  ArchiveRow,
  ArchiveView,
  DownloadStatus,
  ReviewKind,
} from './admin.models';
import { BADGE_LABELS } from '@otus/shared/ui/status-badge';
import { ArchivePlan } from './archive-plan';
import { shortDocName } from './archive-naming';
import { monthLabel } from './labels';

/** Screen copy for A12 월 자료함. Status wording is the student app's (BADGE_LABELS). */

/** Shown when the role may not start a bulk download (only the accountant may) */
export const NO_DOWNLOAD_NOTE = '내려받기는 회계·지정 담당자만 할 수 있어요.';

export const ARCHIVE_KIND_LABELS: Record<ReviewKind, string> = {
  initial: '최초 4종',
  monthly: '월별 서류',
  supplement: '보완 제출',
};

export function archiveCriteriaSummary(criteria: ArchiveCriteria): string {
  const status = criteria.status.length
    ? criteria.status.map((value) => BADGE_LABELS[value]).join(', ')
    : '전체 검토 상태';
  const kind = criteria.kind.length
    ? criteria.kind.map((value) => ARCHIVE_KIND_LABELS[value]).join(', ')
    : '전체 제출 종류';
  return `적용 조건: ${status} · ${kind}`;
}

/** "2026-09" → "9월 자료함" */
export function archiveTitle(month: string): string {
  return `${monthNumber(month)}월 자료함`;
}

export function archiveDescription(month: string): string {
  return `${monthLabel(month)} · 교육생이 최종 제출한 PDF를 자동으로 모았어요.`;
}

export function fileCount(rows: readonly ArchiveRow[]): number {
  return rows.reduce((sum, r) => sum + r.files.length, 0);
}

/** The mint box: how many originals are kept, and that drafts are not here. */
export function archiveNotice(view: ArchiveView): { heading: string; body: string } {
  return {
    heading: `접수된 원본 ${fileCount(view.rows)}개가 안전하게 보관되어 있어요`,
    body: '임시 저장 파일은 교육생에게만 보여요. 관리자는 접수된 파일과 검토 상태를 함께 확인해요.',
  };
}

/** "9월 자료 · 3명 중 2명 선택" */
export function tableHeading(month: string, total: number, selected: number): string {
  return `${monthNumber(month)}월 자료 · ${total}명 중 ${selected}명 선택`;
}

/** "선택한 3명 내려받기" */
export function downloadLabel(selected: number): string {
  return `선택한 ${selected}명 내려받기`;
}

/** "고용보험 1개", "신분증 + 통장사본 2개", all four → "최초 4종" */
export function filesSummary(files: readonly DocType[]): string {
  if (files.length === 4) {
    return '최초 4종';
  }
  const names = files.map(shortDocName);
  return `${names.join(' + ')} ${files.length}개`;
}

/** "09.21 09:12" */
export function receivedAt(iso: string): string {
  return `${dotMonthDay(iso)} ${hourMinute(iso)}`;
}

/** The two lines under the buttons */
export function folderNote(
  rows: readonly ArchiveRow[],
  selectedIds: ReadonlySet<number>,
): string[] {
  const chosen = fileCount(rows.filter((r) => selectedIds.has(r.userId)));
  return [
    `이번 달 최종 제출본 ${chosen}개와 제출 목록을 함께 내려받아요.`,
    '기본 서류 3종이나 이전 제출본이 필요할 때만 옵션을 바꾸세요.',
  ];
}

// ---- A13 내려받기 옵션 ----

/** Shown when nobody is selected: there is nothing to preview */
export const NOTHING_SELECTED_NOTE = '선택한 교육생이 없어요. 자료함에서 교육생을 골라 주세요.';

/** The policy under the folder preview */
export const OPTIONS_FOOTNOTE =
  '기본 서류는 선택한 달에 연결된 승인된 버전만 들어가요. 임시 저장은 들어가지 않아요. 제출 목록에는 접수 시각과 검토 상태도 함께 적혀요.';

/** What the ZIP holds, in words: "이번 달 최종 제출본 + 기본 서류 3종 + 제출 목록" */
export function contentParts(options: ArchiveOptions): string[] {
  return [
    '이번 달 최종 제출본',
    ...(options.baseDocs ? ['기본 서류 3종'] : []),
    ...(options.previous ? ['이전 제출본'] : []),
    '제출 목록',
  ];
}

export function isDefaultOptions(options: ArchiveOptions): boolean {
  return !options.baseDocs && !options.previous;
}

/** The mint box of A13 */
export function optionsNotice(
  plan: ArchivePlan,
  options: ArchiveOptions,
): { heading: string; body: string } {
  return {
    heading: `${isDefaultOptions(options) ? '기본 설정' : '선택한 구성'} · ${contentParts(options).join(' + ')}`,
    body: `선택한 ${plan.students.length}명의 PDF ${plan.pdfCount}개를 교육생별 폴더에 정리해요. 파일을 하나씩 고르거나 이름을 바꿀 필요가 없어요.`,
  };
}

export interface FolderRowCopy {
  folder: string;
  files: string;
}

/** "2026년 9월 / 동민_dongkim2" → its files; the last row is the 제출목록.csv in the root */
export function folderRows(plan: ArchivePlan): FolderRowCopy[] {
  return [
    ...plan.students.map((s) => ({
      folder: `${plan.root} / ${s.folder}`,
      files: s.files.join(' · '),
    })),
    { folder: plan.root, files: `${plan.csvName} · 엑셀에서 열 수 있어요` },
  ];
}

// ---- A14 다운로드 시작 ----

/** The title and the line under it, for each state of the download */
export function downloadHeading(status: DownloadStatus): { heading: string; description: string } {
  switch (status) {
    case 'creating':
      return {
        heading: 'ZIP 파일을 만들고 있어요',
        description: '잠시만 기다려 주세요. 다 만들어지면 바로 내려받기가 시작돼요.',
      };
    case 'failed':
      return {
        heading: 'ZIP 파일을 만들지 못했어요',
        description: '자료함의 원본은 그대로 보관돼요. 구성을 확인하고 다시 내려받아 주세요.',
      };
    case 'ready':
      return { heading: '다운로드를 시작했어요', description: '자료함의 원본은 그대로 보관돼요.' };
  }
}

/** "교육생 3명 · PDF 4개 + 제출 목록" */
export function planSummary(plan: ArchivePlan): string {
  return `교육생 ${plan.students.length}명 · PDF ${plan.pdfCount}개 + 제출 목록`;
}

/** The two cards under the box. "자료 보관함 → 2026년 9월" names the 자료함 of that month. */
export function helpCards(plan: ArchivePlan): { heading: string; lines: string[] }[] {
  return [
    {
      heading: '파일을 다시 찾을 때',
      lines: [`자료함 → ${plan.root}`, '같은 자료를 언제든 다시 내려받을 수 있어요.'],
    },
    {
      heading: '파일이 보이지 않을 때',
      lines: [
        '브라우저의 다운로드 상태를 확인해 주세요. 중단되었다면 자료함에서 다시 내려받으세요.',
      ],
    },
  ];
}

export interface DownloadRowCopy {
  label: string;
  value: string;
}

/** "이번 내려받기": the folders, what is in them, and what the 제출 목록 says */
export function downloadRows(plan: ArchivePlan, options: ArchiveOptions): DownloadRowCopy[] {
  return [
    { label: '교육생 폴더', value: plan.students.map((s) => s.folder).join(' · ') },
    { label: '포함 자료', value: contentParts(options).slice(0, -1).join(' · ') },
    { label: '제출 목록', value: '접수 시각 · 파일 종류 · 검토 상태' },
  ];
}

/** Why the page cannot say the download started, or null when it can */
export function blockedReason(canDownload: boolean, selected: number): string | null {
  if (!canDownload) {
    return NO_DOWNLOAD_NOTE;
  }
  return selected === 0 ? NOTHING_SELECTED_NOTE : null;
}
