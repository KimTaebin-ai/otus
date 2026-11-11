import { NgTemplateOutlet } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
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
import { DOC_TYPE_LABELS, DocType, SubmissionFile } from '../core/api.models';
import { ApiService } from '../core/api.service';
import { SlotState, failure, formatSize, isPdf } from './upload-slot';

/**
 * Single-document upload panel (final U04-monthly-empty.png / U04-monthly-ready.png):
 * a dashed drop zone that turns into a mint "파일이 준비됐어요" panel. Drag and drop and
 * "PDF 파일 선택" both work. The checks, progress and error states are the same as
 * `app-upload-slot` (it exports them); only the look differs. Dragging a file over the zone
 * turns its border teal (user decision 2026-10-17).
 */
@Component({
  selector: 'app-drop-panel',
  imports: [Button, NgTemplateOutlet],
  templateUrl: './drop-panel.html',
  styleUrl: './drop-panel.css',
})
export class DropPanel {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly submissionId = input<string | null>(null);
  readonly docType = input.required<DocType>();
  readonly file = input<SubmissionFile | null>(null);
  /** E.g. outside the submission period. */
  readonly disabled = input(false);
  /** The file is a saved draft that can no longer be submitted: "임시 저장한 파일" (final U04-monthly-closed). */
  readonly saved = input(false);

  readonly uploaded = output<SubmissionFile>();

  protected readonly current = linkedSignal(() => this.file());
  protected readonly state = signal<SlotState>({ kind: 'idle' });
  protected readonly dragging = signal(false);
  /** Read out by screen readers when an upload finishes. */
  protected readonly announcement = signal('');
  /** Kept so "다시 업로드" can resend it. */
  private pending: File | null = null;

  protected readonly title = computed(() => DOC_TYPE_LABELS[this.docType()]);
  protected readonly busy = computed(() => this.state().kind === 'uploading');
  protected readonly canPick = computed(
    () => !this.disabled() && !this.busy() && !!this.submissionId(),
  );

  protected onPicked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    // reset so picking the same file again still fires `change`
    input.value = '';
    if (file) {
      void this.accept(file);
    }
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.canPick()) {
      return;
    }
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file && this.canPick()) {
      void this.accept(file);
    }
  }

  protected retry(): void {
    if (this.pending) {
      this.upload(this.pending);
    }
  }

  private async accept(file: File): Promise<void> {
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

  private upload(file: File): void {
    const id = this.submissionId();
    if (!id) {
      return;
    }
    this.state.set({ kind: 'uploading', name: file.name, progress: 0 });
    this.announcement.set('');
    this.api
      .uploadFile(id, this.docType(), file)
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
          }
        },
        error: (err: unknown) => this.state.set(failure(err)),
      });
  }

  protected meta(f: SubmissionFile): string {
    return `${f.original_name} · ${formatSize(f.size)}`;
  }
}
