import { Component, computed, inject, signal } from '@angular/core';

import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

/**
 * 취업 상태 choice (final U06-settings): two option cards, saved at once with
 * `PATCH /api/me/employment`. The selection shows immediately, goes back when saving fails,
 * and further clicks are ignored while a save is running. The result updates
 * `AuthService.me`. Used on /settings and the U06 history screen.
 */
@Component({
  selector: 'app-employment-choice',
  template: `
    <div class="options" role="radiogroup" aria-label="취업 상태">
      @for (option of options; track option.employed) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="selected() === option.employed"
          [class.on]="selected() === option.employed"
          [disabled]="saving()"
          (click)="choose(option.employed)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            @if (selected() === option.employed) {
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            } @else {
              <path
                d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1 M10 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6 M20 19v-1a4 4 0 0 0-3-3.9"
              />
            }
          </svg>
          {{ option.label }}
        </button>
      }
    </div>
    <p class="notice" [class.error]="notice()?.kind === 'error'" aria-live="polite">
      @if (notice(); as n) {
        @if (n.kind === 'ok') {
          <span aria-hidden="true">✓</span>
        }
        {{ n.text }}
      }
    </p>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
    }

    button {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      height: 60px;
      padding: 0 var(--space-2);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-muted);
      font: inherit;
      font-size: var(--font-size-body);
      cursor: pointer;
    }

    button.on {
      border-color: var(--color-teal);
      background: var(--color-mint);
      color: var(--color-teal);
    }

    button:disabled {
      cursor: progress;
    }

    svg {
      flex: none;
      width: var(--size-icon);
      height: var(--size-icon);
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    @media (max-width: 480px) {
      .options {
        grid-template-columns: minmax(0, 1fr);
      }

      button {
        height: auto;
        min-height: 60px;
        padding-block: var(--space-1);
        text-align: left;
      }
    }

    .notice {
      margin: 0;
      min-height: 1.5em;
      font-size: var(--font-size-body);
      color: var(--color-teal);
    }

    .notice.error {
      color: var(--color-red);
    }
  `,
})
export class EmploymentChoice {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly options = [
    { employed: false, label: '아직 일하고 있지 않아요' },
    { employed: true, label: '네, 일하고 있어요' },
  ];
  protected readonly saving = signal(false);
  /** The clicked option while its save runs; null otherwise (then the saved value shows). */
  private readonly pending = signal<boolean | null>(null);
  protected readonly selected = computed(() => this.pending() ?? this.auth.me()?.employed ?? false);
  protected readonly notice = signal<Notice | null>(null);

  protected choose(employed: boolean): void {
    if (this.saving() || employed === this.selected()) {
      return;
    }
    this.saving.set(true);
    this.pending.set(employed);
    this.notice.set(null);
    this.api.setEmployment(employed).subscribe({
      next: (me) => {
        this.auth.setMe(me);
        this.pending.set(null);
        this.saving.set(false);
        this.notice.set({
          kind: 'ok',
          text: employed
            ? '취업 중으로 저장했어요. 이제 미제출 안내는 보내지 않을게요.'
            : '미취업으로 저장했어요. 서류 제출 안내를 다시 보여드릴게요.',
        });
      },
      error: (err: unknown) => {
        this.pending.set(null);
        this.saving.set(false);
        this.notice.set({ kind: 'error', text: errorMessage(err) });
      },
    });
  }
}
