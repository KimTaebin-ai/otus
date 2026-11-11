import { ArchiveOptions, ArchiveRow } from './admin.models';
import {
  CSV_NAME,
  baseFileName,
  currentFileName,
  previousFileName,
  rootFolder,
  studentFolder,
  uniqueNames,
  zipName,
} from './archive-naming';

export interface PlanStudent {
  userId: number;
  name: string;
  login: string;
  folder: string;
  files: string[];
}

/** What the ZIP will hold, as A13 previews it and A14 summarizes it. */
export interface ArchivePlan {
  root: string;
  zipName: string;
  csvName: string;
  students: PlanStudent[];
  pdfCount: number;
}

/**
 * The ZIP for the selected rows: the month's final submissions always, the 기본 서류 and the
 * older versions only when the options say so, plus the 제출목록.csv. Drafts are not rows, and
 * a base document the submission already contains (the 최초 4종) is not added twice.
 */
export function planArchive(
  month: string,
  rows: readonly ArchiveRow[],
  options: ArchiveOptions,
): ArchivePlan {
  const folders = uniqueNames(rows.map((r) => studentFolder(r.name, r.login)));
  const students = rows.map((r, i) => {
    const files = [
      ...r.files.map((t) => currentFileName(month, t)),
      ...(options.baseDocs ? r.baseDocs.filter((t) => !r.files.includes(t)).map(baseFileName) : []),
      ...(options.previous ? r.previous.map((t) => previousFileName(month, t)) : []),
    ];
    return {
      userId: r.userId,
      name: r.name,
      login: r.login,
      folder: folders[i],
      files: uniqueNames(files, true),
    };
  });
  return {
    root: rootFolder(month),
    zipName: zipName(month),
    csvName: CSV_NAME,
    students,
    pdfCount: students.reduce((sum, s) => sum + s.files.length, 0),
  };
}
