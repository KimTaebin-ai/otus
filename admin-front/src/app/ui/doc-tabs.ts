import { Component, input, output } from '@angular/core';

import { DocType } from '@otus/shared/core/api-types';
import { docLabel } from '../core/review-copy';

/**
 * The document tabs of a review (A02-initial-review-*): one per document, the open one is
 * mint with a teal border and says "현재 보는 서류", the others "PDF 첨부됨". A single document
 * (monthly) still shows its one tab.
 */
@Component({
  selector: 'app-doc-tabs',
  template: `
    <div role="tablist" aria-label="제출 서류">
      @for (type of types(); track type) {
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="type === active()"
          [class.active]="type === active()"
          (click)="select.emit(type)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6"
            />
          </svg>
          <span class="text">
            <strong>{{ label(type) }}</strong>
            <span>{{ type === active() ? '현재 보는 서류' : 'PDF 첨부됨' }}</span>
          </span>
        </button>
      }
    </div>
  `,
  styles: `
    [role='tablist'] {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
      gap: var(--space-2);
    }

    @media (max-width: 720px) {
      [role='tablist'] {
        grid-template-columns: minmax(0, 1fr);
      }

      button {
        padding: 0 var(--space-2);
      }
    }

    button {
      display: flex;
      align-items: center;
      gap: calc(var(--space-1) * 1.5);
      min-height: 64px;
      padding: 0 var(--space-3);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      font: inherit;
      color: var(--color-ink);
      text-align: left;
      cursor: pointer;
    }

    button.active {
      border-color: var(--color-teal);
      background: var(--color-mint);
    }

    button:focus-visible {
      outline: calc(var(--border-width) * 2) solid var(--color-teal);
      outline-offset: calc(var(--border-width) * 2);
    }

    svg {
      flex: none;
      width: var(--size-icon);
      height: var(--size-icon);
      fill: none;
      stroke: var(--color-muted);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .active svg {
      stroke: var(--color-teal);
    }

    .text {
      display: flex;
      flex-direction: column;
    }

    strong {
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
    }

    .active strong {
      color: var(--color-teal);
    }

    .text span {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }

    .active .text span {
      color: var(--color-muted);
    }
  `,
})
export class DocTabs {
  readonly types = input.required<readonly DocType[]>();
  readonly active = input.required<DocType>();
  readonly select = output<DocType>();

  protected label(type: DocType): string {
    return docLabel(type);
  }
}
