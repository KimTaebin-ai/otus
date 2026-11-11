import { StudentProfile, studentLabel } from '../core/cohort';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SubmissionStatus } from '@otus/shared/core/api-types';
import { Button } from '@otus/shared/ui/button';
import { StatusBadge } from '@otus/shared/ui/status-badge';

/**
 * Head shared by the review pages (A02, A03): "← 검토 목록", the title and one muted line,
 * "사용자 전체 이력 ↗" on the right, and the user row (avatar, name · login, 취업 상태, what was
 * submitted and when, the status badge). Pure display; the links keep `?preview`.
 */
@Component({
  selector: 'app-review-header',
  imports: [Button, RouterLink, StatusBadge],
  template: `
    <div class="head">
      <div class="text">
        <a class="back" routerLink="/submissions" queryParamsHandling="preserve">
          <span aria-hidden="true">←</span> 검토 목록
        </a>
        <h1>{{ heading() }}</h1>
        <p class="description">{{ description() }}</p>
      </div>
      <button
        appButton
        variant="secondary"
        type="button"
        [routerLink]="['/users', userId()]"
        queryParamsHandling="preserve"
      >
        사용자 전체 이력 ↗
      </button>
    </div>

    <div class="user">
      <span class="avatar" aria-hidden="true">{{ initial() }}</span>
      <div class="who">
        <strong>{{ label() }}</strong>
        <span>{{ login() }} · {{ employed() ? '취업 중' : '미취업' }}</span>
      </div>
      <div class="what">
        <strong>{{ summary() }}</strong>
        <span>{{ sub() }}</span>
      </div>
      <app-status-badge class="badge" [status]="status()" />
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    @media (max-width: 720px) {
      .head {
        flex-direction: column;
        gap: var(--space-2);
      }

      .head > button {
        margin-top: 0;
      }

      .user {
        flex-wrap: wrap;
        padding: var(--space-1) var(--space-2);
      }

      .who {
        min-width: 0;
      }
    }

    .head > button {
      margin-top: var(--space-3);
    }

    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-3);
    }

    .text {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    p,
    h1 {
      margin: 0;
    }

    .back {
      font-size: var(--font-size-caption);
      color: var(--color-teal);
      text-decoration: none;
    }

    .back:focus-visible {
      outline: calc(var(--border-width) * 2) solid var(--color-teal);
      outline-offset: calc(var(--border-width) * 2);
    }

    h1 {
      font-size: var(--font-size-page-title);
      line-height: 1.3;
      font-weight: var(--font-weight-bold);
    }

    .description {
      font-size: var(--font-size-body);
      color: var(--color-muted);
    }

    .user {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: calc(var(--space-1) * 1.5) var(--space-3);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }

    .avatar {
      display: grid;
      place-items: center;
      flex: none;
      width: var(--size-avatar);
      height: var(--size-avatar);
      border-radius: var(--radius-pill);
      background: var(--color-mint);
      color: var(--color-teal);
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
    }

    .who,
    .what {
      display: flex;
      flex-direction: column;
    }

    .who {
      min-width: 100px;
      margin-right: var(--space-1);
    }

    strong {
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
    }

    .who span,
    .what span {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }

    .badge {
      margin-left: auto;
    }
  `,
})
export class ReviewHeader {
  readonly heading = input.required<string>();
  readonly description = input.required<string>();
  readonly userId = input.required<number>();
  readonly name = input.required<string>();
  /** 기수·한글 이름·생년월일 of the student, for the label */
  readonly profile = input<StudentProfile | null | undefined>(null);
  readonly login = input.required<string>();
  readonly employed = input.required<boolean>();
  /** "최초 등록 · 서류 4개" */
  readonly summary = input.required<string>();
  /** "2026.09.21 09:41 제출 · 9월 접수 건" */
  readonly sub = input.required<string>();
  readonly status = input.required<SubmissionStatus>();

  protected readonly label = computed(() => studentLabel(this.name(), this.profile()));
  protected readonly initial = computed(() => this.name().slice(0, 1));
}
