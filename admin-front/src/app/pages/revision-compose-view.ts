import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DocType } from '@otus/shared/core/api-types';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { ReviewView } from '../core/admin.models';
import {
  REASON_HELP,
  REASON_MAX,
  REVISION_DESCRIPTION,
  STUDENT_PREVIEW_NOTES,
  composeSummary,
  docLabel,
  dueSentence,
  resubmitDue,
  revisionBlocker,
  revisionTitle,
  submittedSummary,
} from '../core/review-copy';
import { ReasonMacro, hasMacro, insertMacro, macrosFor } from '../core/revision-macros';
import { ReviewHeader } from '../ui/review-header';

/**
 * 보완 요청 작성 (final A03-revision-compose.png for one document; with several documents, the
 * 최초 4종, there is no image: the same layout where "보완을 요청할 서류" can pick any of them, at
 * least one). The reason is required and at most 1000 characters; the student sees it as written,
 * and the right card shows exactly that. Pure display; nothing is sent.
 */
@Component({
  selector: 'app-revision-compose-view',
  imports: [Button, Card, ReviewHeader, RouterLink],
  template: `
    <app-review-header
      [heading]="title()"
      [description]="description"
      [userId]="view().userId"
      [name]="view().name"
      [profile]="view().profile"
      [login]="view().login"
      [employed]="view().employed"
      [summary]="summary()"
      [sub]="sub()"
      [status]="view().status"
    />

    <div class="columns">
      <app-card>
        <h2 class="card-title">보완을 요청할 서류</h2>
        <ul class="docs">
          @for (doc of view().docs; track doc.docType) {
            <li>
              <button
                type="button"
                role="checkbox"
                class="doc"
                [class.on]="isOn(doc.docType)"
                [attr.aria-checked]="isOn(doc.docType)"
                [disabled]="!pickable()"
                (click)="toggle.emit(doc.docType)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6"
                  />
                </svg>
                <span class="name">
                  <strong>{{ label(doc.docType) }}</strong>
                  <span>{{ doc.fileName }}</span>
                </span>
                @if (pickable()) {
                  <span class="check" aria-hidden="true">{{ isOn(doc.docType) ? '✓' : '' }}</span>
                }
              </button>
            </li>
          }
        </ul>

        <label class="reason-label" for="reason">보완 사유 · 필수</label>
        <div class="macros" role="group" aria-label="자주 쓰는 보완 사유">
          <span class="macros-title">자주 쓰는 사유 · 누르면 아래에 채워져요</span>
          @for (macro of macros(); track macro.label) {
            <button
              type="button"
              class="macro"
              [attr.aria-pressed]="has(macro)"
              [attr.title]="macro.text"
              [disabled]="!canInsert(macro)"
              (click)="insert(macro)"
            >
              {{ has(macro) ? '✓ ' : '+ ' }}{{ macro.label }}
            </button>
          }
        </div>
        <textarea
          id="reason"
          rows="4"
          [attr.maxlength]="reasonMax"
          [value]="reason()"
          (input)="onReason($event)"
        ></textarea>
        <p class="help">
          {{ help }}
          <span class="count">{{ count() }} / {{ reasonMax }}</span>
        </p>

        <hr />
        <div class="due">
          <span>재제출 마감</span>
          <strong>{{ due() }}</strong>
        </div>

        @if (blocker(); as why) {
          <p class="blocker" role="status">{{ why }}</p>
        }
        <div class="actions">
          <button
            appButton
            variant="secondary"
            type="button"
            [routerLink]="['/submissions', view().submissionId]"
            queryParamsHandling="preserve"
          >
            검토로 돌아가기
          </button>
          <button
            appButton
            type="button"
            [disabled]="disabled() || !!blocker()"
            (click)="confirm.emit()"
          >
            보완 요청 확정
          </button>
        </div>
      </app-card>

      <app-card>
        <h2 class="card-title">사용자에게 이렇게 보여요</h2>
        <span class="tag">보완 요청</span>
        <h3>{{ chosenNames() }}</h3>
        <p class="shown" [class.placeholder]="!reason().trim()">
          {{ reason().trim() || '사유를 적으면 여기에 그대로 보여요.' }}
        </p>
        <hr />
        <p class="deadline">{{ dueText() }}</p>
        <p class="notes">
          @for (note of notes; track note) {
            {{ note }}<br />
          }
        </p>
      </app-card>
    </div>
  `,
  styleUrl: './revision-compose-view.css',
})
export class RevisionComposeViewComponent {
  readonly view = input.required<ReviewView>();
  readonly reason = input('');
  readonly selected = input<readonly DocType[]>([]);
  readonly disabled = input(false);
  readonly confirm = output<void>();

  readonly reasonChange = output<string>();
  readonly toggle = output<DocType>();

  protected readonly description = REVISION_DESCRIPTION;
  protected readonly help = REASON_HELP;
  protected readonly reasonMax = REASON_MAX;
  protected readonly notes = STUDENT_PREVIEW_NOTES;

  /** With one document there is nothing to choose: it is asked for. */
  protected readonly pickable = computed(() => this.view().docs.length > 1);
  protected readonly title = computed(() => revisionTitle(this.view()));
  protected readonly summary = computed(() => composeSummary(this.view()));
  protected readonly sub = computed(() => submittedSummary(this.view()));
  protected readonly due = computed(() => resubmitDue(this.view()));
  protected readonly dueText = computed(() => dueSentence(this.view()));
  protected readonly count = computed(() => [...this.reason()].length);
  protected readonly chosen = computed(() =>
    this.pickable() ? this.selected() : this.view().docs.map((d) => d.docType),
  );
  protected readonly chosenNames = computed(
    () => this.chosen().map(docLabel).join(', ') || '서류를 골라주세요',
  );
  protected readonly blocker = computed(() => revisionBlocker(this.chosen().length, this.reason()));

  /** Ready-made sentences: those of the chosen documents first */
  protected readonly macros = computed(() => macrosFor(this.chosen()));

  protected has(macro: ReasonMacro): boolean {
    return hasMacro(this.reason(), macro);
  }

  /** Already in, or it would not fit the limit: nothing to add */
  protected canInsert(macro: ReasonMacro): boolean {
    return insertMacro(this.reason(), macro) !== null;
  }

  protected insert(macro: ReasonMacro): void {
    const next = insertMacro(this.reason(), macro);
    if (next !== null) this.reasonChange.emit(next);
  }

  protected isOn(type: DocType): boolean {
    return this.chosen().includes(type);
  }

  protected label(type: DocType): string {
    return docLabel(type);
  }

  protected onReason(event: Event): void {
    this.reasonChange.emit((event.target as HTMLTextAreaElement).value);
  }
}
