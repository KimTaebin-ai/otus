import { Component, computed, input, linkedSignal } from '@angular/core';

import { DOC_TYPE_LABELS, DocType } from '../core/api.models';
import { DOC_GUIDES } from '../core/doc-guides';

/**
 * "서류는 어디서 받나요?": for each document, where to get it, what to do there and a link to the
 * official site when there is one. Used on every screen that asks for documents (U02 최초 4종,
 * U04 월별 제출, U05 보완 제출). `compact` drops the heading and the document names for a
 * single document that is already named by the card around it.
 */
@Component({
  selector: 'app-doc-guide',
  template: `
    <section class="guide" [class.compact]="compact()" [attr.aria-label]="heading()">
      @if (!compact()) {
        <div class="head">
          <h3>{{ heading() }}</h3>
          @if (collapsible()) {
            <button
              type="button"
              class="toggle"
              [attr.aria-expanded]="open()"
              aria-controls="doc-guide-list"
              (click)="open.set(!open())"
            >
              {{ open() ? '접기' : '펼치기' }}
              <svg viewBox="0 0 24 24" aria-hidden="true" [class.up]="open()">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          }
        </div>
        @if (!open()) {
          <p class="summary">{{ names() }}</p>
        }
      }
      @if (open()) {
        <ul id="doc-guide-list">
          @for (item of items(); track item.type) {
            <li>
              @if (!compact()) {
                <strong class="name">{{ item.name }}</strong>
              }
              <p class="how">
                <span class="where">{{ item.guide.where }}</span
                >에서 — {{ item.guide.how }}
              </p>
              @if (item.guide.link; as link) {
                <a [href]="link.url" target="_blank" rel="noopener noreferrer">
                  {{ link.label }} ↗<span class="sr-only"> (새 창에서 열려요)</span>
                </a>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .guide {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-3);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }

    h3,
    p {
      margin: 0;
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }

    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: calc(var(--space-1) / 2) var(--space-2);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      color: var(--color-muted);
      font: inherit;
      font-size: var(--font-size-caption);
      cursor: pointer;
    }

    .toggle:hover {
      border-color: var(--color-teal);
      color: var(--color-teal);
    }

    .toggle:focus-visible {
      outline: 2px solid var(--color-teal);
      outline-offset: 2px;
    }

    .toggle svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 0.2s ease;
    }

    .toggle svg.up {
      transform: rotate(180deg);
    }

    .summary {
      font-size: var(--font-size-body);
      color: var(--color-muted);
    }

    @media (prefers-reduced-motion: reduce) {
      .toggle svg {
        transition: none;
      }
    }

    h3 {
      font-size: var(--font-size-feature-title);
      font-weight: var(--font-weight-bold);
      color: var(--color-ink);
    }

    ul {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-1);
      padding: var(--space-2) 0;
      border-top: var(--border-width) solid var(--color-border);
    }

    li:first-child {
      padding-top: 0;
      border-top: 0;
    }

    li:last-child {
      padding-bottom: 0;
    }

    .name {
      font-size: var(--font-size-lead);
      font-weight: var(--font-weight-bold);
      color: var(--color-teal);
    }

    .how {
      font-size: var(--font-size-body);
      line-height: 1.6;
      color: var(--color-muted);
      word-break: keep-all;
    }

    .where {
      font-weight: var(--font-weight-medium);
      color: var(--color-ink);
    }

    a {
      display: inline-flex;
      align-items: center;
      padding: calc(var(--space-1) / 2) var(--space-2);
      border: var(--border-width) solid var(--color-teal);
      border-radius: var(--radius-pill);
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
      color: var(--color-teal);
      text-decoration: none;
    }

    a:hover {
      background: var(--color-mint);
    }

    a:focus-visible {
      outline: 2px solid var(--color-teal);
      outline-offset: 2px;
    }

    .compact {
      margin-top: var(--space-2);
      padding: var(--space-2);
      border-radius: var(--radius-md);
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class DocGuideBox {
  readonly docTypes = input.required<readonly DocType[]>();
  readonly heading = input('서류는 어디서 받나요?');
  readonly compact = input(false);
  /** A header button folds the list away (the list is long; the screen should not need a scroll) */
  readonly collapsible = input(false);
  /** Whether a collapsible guide starts unfolded */
  readonly startOpen = input(true);
  protected readonly open = linkedSignal(() => this.startOpen() || !this.collapsible());

  /** What is folded away, in one line: "신분증 · 주민등록초본 · …" */
  protected readonly names = computed(() =>
    this.docTypes()
      .map((type) => DOC_TYPE_LABELS[type])
      .join(' · '),
  );

  protected readonly items = computed(() =>
    this.docTypes().map((type) => ({
      type,
      name: DOC_TYPE_LABELS[type],
      guide: DOC_GUIDES[type],
    })),
  );
}
