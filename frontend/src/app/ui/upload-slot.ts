import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Button } from '@otus/shared/ui/button';
import { ApiErrorBody, DOC_TYPE_LABELS, DocType, SubmissionFile } from '../core/api.models';
import { ApiService, errorMessage } from '../core/api.service';
import { PdfPreview } from './pdf-preview';

export type SlotState =
  | { kind: 'idle' }
  | { kind: 'uploading'; name: string; progress: number }
  /** Not a PDF, too large, or refused by the server: pick another file. */
  | { kind: 'invalid'; title: string; message: string }
  /** Network or server failure: retry the same file. */
  | { kind: 'failed' };

/**
 * One document row with PDF upload (docs/design/README.md "업로드된 파일 행", "알림·검증 박스").
 *
 * - `mode="upload"`: empty row ("파일 고르기") → progress → uploaded row with "변경" (teal border,
 *   mint background, check icon; not in final, user decision 2026-10-17), plus the red
 *   (형식 오류) and amber (전송 실패) boxes from Validation states.png.
 * - `mode="kept"`: the U04 "유지" row for unchanged base documents. No file input.
 * - `mode="view"`: a submitted file (U05 history, final U05-history-pending): white row with the
 *   document icon, "파일명 · 크기" (name only without a size), no link. The mint/check look is only
 *   for a fresh upload.
 *
 * The PDF check here (extension, MIME type, `%PDF-`) only saves a round trip; the server
 * checks again and decides the size limit.
 */
@Component({
  selector: 'app-upload-slot',
  imports: [Button, NgTemplateOutlet, PdfPreview],
  templateUrl: './upload-slot.html',
  styleUrl: './upload-slot.css',
})
export class UploadSlot {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly submissionId = input<string | null>(null);
  readonly docType = input<DocType>();
  /** Overrides the doc type label, e.g. "신분증 / 주민등록초본 / 통장사본" for a kept row. */
  readonly label = input<string>();
  readonly description = input('');
  /** The current file of this doc type. */
  readonly file = input<SubmissionFile | null>(null);
  readonly mode = input<'upload' | 'kept' | 'view'>('upload');
  /** E.g. outside the submission period. */
  readonly disabled = input(false);
  /** Shown instead of "파일 고르기" on an empty row while `disabled`, e.g. "기간 종료" (final U02 closed). */
  readonly lockedLabel = input<string>();
  /** Red border: a required file is still missing after a submit attempt. */
  readonly invalid = input(false);

  readonly uploaded = output<SubmissionFile>();
  /** The picked PDF itself, emitted together with `uploaded` (e.g. to send the 통장사본 on to the 계좌 request). */
  readonly uploadedFile = output<File>();

  protected readonly current = linkedSignal(() => this.file());
  protected readonly previewing = signal(false);
  protected readonly state = signal<SlotState>({ kind: 'idle' });
  /** Read out by screen readers when an upload finishes; the row itself turns mint. */
  protected readonly announcement = signal('');
  /** Kept so "다시 업로드" can resend it. */
  private pending: File | null = null;

  protected readonly title = computed(() => {
    const type = this.docType();
    return this.label() ?? (type ? DOC_TYPE_LABELS[type] : '');
  });
  protected readonly busy = computed(() => this.state().kind === 'uploading');
  protected readonly canPreview = computed(() => this.mode() === 'view' && !!this.current());

  /**
   * The whole row is the click target: it opens the file picker (upload mode) or the PDF preview
   * (view mode), not just its "변경" / "파일 고르기" / "미리보기" text. Clicks inside the preview
   * dialog also bubble up to the row, so they are ignored.
   */
  protected onRowClick(event: Event, picker: HTMLInputElement): void {
    if ((event.target as Element).closest('app-pdf-preview')) {
      return;
    }
    if (this.canPreview()) {
      this.previewing.set(true);
    } else if (this.rowPickable()) {
      picker.click();
    }
  }

  /** Only in upload mode. */
  protected readonly rowPickable = computed(
    () => this.mode() === 'upload' && this.canPick() && this.state().kind !== 'uploading',
  );
  protected readonly canPick = computed(
    () => !this.disabled() && !this.busy() && !!this.submissionId() && !!this.docType(),
  );

  protected async onPicked(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    // reset so picking the same file again still fires `change`
    input.value = '';
    if (!file) {
      return;
    }
    if (!(await isPdf(file))) {
      this.state.set({
        kind: 'invalid',
        title: 'PDF 파일만 제출할 수 있어요',
        message: `${file.name} 파일은 지원하지 않습니다. PDF로 변환한 파일을 선택해주세요.`,
      });
      return;
    }
    this.pending = file;
    this.upload(file);
  }

  protected retry(): void {
    if (this.pending) {
      this.upload(this.pending);
    }
  }

  private upload(file: File): void {
    const id = this.submissionId();
    const type = this.docType();
    if (!id || !type) {
      return;
    }
    this.state.set({ kind: 'uploading', name: file.name, progress: 0 });
    this.announcement.set('');
    this.api
      .uploadFile(id, type, file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const progress = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
            this.state.set({ kind: 'uploading', name: file.name, progress });
          } else if (event.type === HttpEventType.Response && event.body) {
            this.pending = null;
            this.current.set(event.body);
            this.state.set({ kind: 'idle' });
            this.announcement.set(`${this.title()} 업로드 완료: ${event.body.original_name}`);
            this.uploaded.emit(event.body);
            this.uploadedFile.emit(file);
          }
        },
        error: (err: unknown) => this.state.set(failure(err)),
      });
  }

  protected meta(f: SubmissionFile): string {
    return `${f.original_name} · ${formatSize(f.size)}`;
  }
}

/** Status 0 (no connection) and 5xx are worth retrying as is; anything else needs a new file. */
export function failure(err: unknown): SlotState {
  if (!(err instanceof HttpErrorResponse) || err.status === 0 || err.status >= 500) {
    return { kind: 'failed' };
  }
  const code = (err.error as Partial<ApiErrorBody> | null)?.error?.code;
  return {
    kind: 'invalid',
    title: code === 'NOT_PDF' ? 'PDF 파일만 제출할 수 있어요' : '파일을 올릴 수 없어요',
    message: errorMessage(err),
  };
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Mirrors the server's api.md check: `.pdf` name, application/pdf, `%PDF-` first bytes. */
export async function isPdf(file: File): Promise<boolean> {
  if (!file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf') {
    return false;
  }
  const head = new Uint8Array(await file.slice(0, PDF_MAGIC.length).arrayBuffer());
  return PDF_MAGIC.every((byte, i) => head[i] === byte);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
