import { Component, inject, input } from '@angular/core';

import { PdfViewer } from './pdf-viewer';
import { ArchiveFileSaver } from '../core/archive-api';
import { ReviewDoc } from '../core/admin.models';
import { NO_ORIGINALS_NOTE } from '../core/user-record-copy';
import { sizeText } from '../core/review-copy';

/**
 * Where the PDF is shown (A02-initial-review-*): file name, "PDF · 크기", "↓ 다운로드", and
 * the page with its zoom and page controls (`app-pdf-viewer`, pdf.js on a canvas). Only operator
 * and accountant can read originals: for others (admin) the page area says so and the download
 * is off. The document in the images is a design example and is not drawn.
 */
@Component({
  selector: 'app-pdf-slot',
  imports: [PdfViewer],
  template: `
    <div class="bar">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6"
        />
      </svg>
      <strong class="file">{{ doc().fileName }}</strong>
      <span class="meta">PDF · {{ size() }}</span>
      @if (canOpen()) {
        <a
          class="download"
          [href]="'/api/files/' + doc().fileId"
          target="_blank"
          rel="noopener"
          (click)="save($event)"
        >
          ↓ 다운로드
        </a>
      } @else {
        <span class="download disabled" aria-disabled="true">↓ 다운로드</span>
      }
    </div>
    @if (canOpen()) {
      <app-pdf-viewer [fileId]="doc().fileId" />
    } @else {
      <div class="page">
        <p class="empty">PDF는 운영·회계 담당자만 볼 수 있어요</p>
        <p class="note" role="note">{{ note }}</p>
      </div>
      <div class="tools" aria-hidden="true">
        <span class="zoom">− &nbsp;100% &nbsp;+</span>
        <span class="pages">‹ &nbsp;0 / 0 페이지 &nbsp;›</span>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 584px;
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      overflow: hidden;
    }

    @media (max-width: 600px) {
      :host {
        min-height: 360px;
      }

      .bar,
      .tools {
        padding: 0 var(--space-2);
      }
    }

    .bar {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      height: 56px;
      padding: 0 var(--space-3);
    }

    svg {
      flex: none;
      width: var(--size-icon);
      height: var(--size-icon);
      fill: none;
      stroke: var(--color-teal);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .file {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--font-size-lead);
      font-weight: var(--font-weight-medium);
    }

    .meta {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }

    .download {
      font-size: var(--font-size-caption);
      color: var(--color-teal);
      text-decoration: none;
    }

    .download.disabled {
      color: var(--color-muted);
      opacity: 0.6;
      cursor: not-allowed;
    }

    .download:focus-visible {
      outline: calc(var(--border-width) * 2) solid var(--color-teal);
      outline-offset: calc(var(--border-width) * 2);
    }

    .page {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-1);
      background: var(--color-mint);
    }

    p {
      margin: 0;
    }

    .empty {
      font-size: var(--font-size-lead);
      color: var(--color-muted);
    }

    .note {
      font-size: var(--font-size-caption);
      color: var(--color-amber);
    }

    .tools {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
      padding: 0 var(--space-3);
      font-size: var(--font-size-caption);
      color: var(--color-muted);
      opacity: 0.6;
    }
  `,
})
export class PdfSlot {
  readonly doc = input.required<ReviewDoc>();
  readonly canOpen = input(false);
  /** The name the browser saves the PDF under, e.g. "3기B_홍길동(021205).pdf" */
  readonly downloadName = input<string | null>(null);

  private readonly saver = inject(ArchiveFileSaver);
  protected readonly note = NO_ORIGINALS_NOTE;

  /** The server names the attachment after the uploaded file, so the PDF is fetched and saved here. */
  protected async save(event: Event): Promise<void> {
    const name = this.downloadName();
    if (!name) return;
    event.preventDefault();
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(this.doc().fileId)}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(String(res.status));
      this.saver.save(await res.blob(), name);
    } catch {
      // fall back to the server's own download in a new tab
      window.open(`/api/files/${encodeURIComponent(this.doc().fileId)}`, '_blank', 'noopener');
    }
  }

  protected size(): string {
    return sizeText(this.doc().sizeBytes);
  }
}
