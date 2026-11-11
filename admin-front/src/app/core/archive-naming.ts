import { DOC_TYPE_LABELS, DocType } from '@otus/shared/core/api-types';
import { monthNumber } from '@otus/shared/core/format';

/**
 * Folder and file names inside the ZIP (A13/A14). The same rules go into
 * docs/api-proposal-admin.md, so the server builds the names the preview shows.
 */

/** Characters no file system accepts everywhere, control characters, invisible format ones (U+202E) */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\p{Cf}]/gu;
/** Names Windows refuses, with or without an extension */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * One path segment made safe: unsafe characters become "_", spaces are collapsed, trailing dots
 * and spaces are dropped (Windows), the name is cut to `max` characters, never empty, never a
 * Windows device name. Normalized to NFC so macOS and Windows agree on a Korean name.
 */
export function safeName(raw: string, max = 40): string {
  let name = raw.normalize('NFC').replace(UNSAFE, '_').replace(/\s+/g, ' ').trim();
  name = [...name]
    .slice(0, max)
    .join('')
    .replace(/[. ]+$/, '');
  if (!name) {
    return '_';
  }
  return RESERVED.test(name.split('.')[0]) ? `_${name}` : name;
}

/**
 * Makes names unique in one folder: the second "a.pdf" becomes "a_2.pdf", the third "a_3.pdf".
 * Compared as NFC and case-insensitively, because macOS and Windows treat "A.pdf" and "a.pdf"
 * as one file. `withExtension` puts the number before the extension.
 */
export function uniqueNames(names: readonly string[], withExtension = false): string[] {
  const key = (n: string) => n.normalize('NFC').toLowerCase();
  const used = new Set<string>();
  return names.map((name) => {
    const dot = withExtension ? name.lastIndexOf('.') : -1;
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; used.has(key(candidate)); n++) {
      candidate = `${stem}_${n}${ext}`;
    }
    used.add(key(candidate));
    return candidate;
  });
}

const SHORT_NAMES: Partial<Record<DocType, string>> = { employment_insurance: '고용보험' };

/** 고용보험가입내역서 is "고용보험" in file names and the table; the others keep their name. */
export function shortDocName(docType: DocType): string {
  return SHORT_NAMES[docType] ?? DOC_TYPE_LABELS[docType];
}

/** "2026-09" → "2026년 9월", the folder every student folder sits in */
export function rootFolder(month: string): string {
  return `${month.slice(0, 4)}년 ${monthNumber(month)}월`;
}

/** "2026년 9월_지원금 자료.zip" */
export function zipName(month: string): string {
  return `${rootFolder(month)}_지원금 자료.zip`;
}

export const CSV_NAME = '제출목록.csv';

/** "동민_dongkim2" (not yet made unique among the students) */
export function studentFolder(name: string, login: string): string {
  return `${safeName(name)}_${safeName(login)}`;
}

/** "9월_고용보험.pdf": a file of the month's final submission */
export function currentFileName(month: string, docType: DocType): string {
  return `${monthNumber(month)}월_${shortDocName(docType)}.pdf`;
}

/** "기본서류_통장사본.pdf": the approved base document linked to the month */
export function baseFileName(docType: DocType): string {
  return `기본서류_${DOC_TYPE_LABELS[docType]}.pdf`;
}

/** "이전제출본_9월_고용보험.pdf": an older version, replaced by a 보완 제출 */
export function previousFileName(month: string, docType: DocType): string {
  return `이전제출본_${monthNumber(month)}월_${shortDocName(docType)}.pdf`;
}
