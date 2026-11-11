import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { ApiService, errorMessage } from '../core/api.service';

/** Modal PDF preview: fetches the original (owner only) and shows it from a blob: URL. */
@Component({
  selector: 'app-pdf-preview',
  template: `
    <dialog
      #dlg
      class="dlg"
      [attr.aria-label]="name() + ' 미리보기'"
      (close)="closed.emit()"
      (click)="onBackdrop($event)"
    >
      <header>
        <strong>{{ name() }}</strong>
        <button type="button" class="x" aria-label="닫기" (click)="dlg.close()">✕</button>
      </header>
      @if (error(); as e) {
        <p class="msg" role="alert">{{ e }}</p>
      } @else if (url(); as u) {
        <iframe [src]="u" [title]="name()"></iframe>
      } @else {
        <p class="msg">불러오는 중이에요…</p>
      }
    </dialog>
  `,
  styles: `
    .dlg {
      width: min(900px, 94vw);
      height: min(88vh, 900px);
      padding: 0;
      border: 0;
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: inherit;
      overflow: hidden;
    }
    .dlg[open] {
      display: flex;
      flex-direction: column;
    }
    .dlg::backdrop {
      background: rgb(0 0 0 / 0.5);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border-bottom: var(--border-width) solid var(--color-border);
    }
    .x {
      border: 0;
      background: none;
      cursor: pointer;
      font-size: var(--font-size-lead);
      color: var(--color-muted);
    }
    @media (max-width: 600px) {
      .dlg {
        width: 100vw;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        border-radius: 0;
      }
    }

    iframe {
      flex: 1;
      width: 100%;
      border: 0;
    }
    .msg {
      margin: var(--space-4) var(--space-3);
      color: var(--color-muted);
    }
  `,
})
export class PdfPreview {
  private readonly api = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly fileId = input.required<string>();
  readonly name = input('');
  readonly closed = output<void>();

  protected readonly url = signal<SafeResourceUrl | null>(null);
  protected readonly error = signal<string | null>(null);
  private objectUrl: string | null = null;

  constructor() {
    afterNextRender(() => {
      this.dlg().nativeElement.showModal();
      this.api
        .fileBlob(this.fileId())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (blob) => {
            this.objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
            this.url.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
          },
          error: (err: unknown) => this.error.set(errorMessage(err)),
        });
    });
    this.destroyRef.onDestroy(() => this.objectUrl && URL.revokeObjectURL(this.objectUrl));
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dlg().nativeElement) {
      this.dlg().nativeElement.close();
    }
  }
}
