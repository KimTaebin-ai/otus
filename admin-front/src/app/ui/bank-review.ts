import { Component, computed, input, output, signal } from '@angular/core';

import { dotDateTime } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { UserRecordView } from '../core/admin.models';

/** What the staff decided on the pending 계좌 변경 */
export interface BankDecision {
  requestId: number;
  decision: 'approved' | 'rejected';
  note?: string;
}

/** The longest 반려 사유; the student reads it as written (same limit as the server) */
export const BANK_NOTE_MAX = 1000;

/**
 * 지원금 수령 계좌 승인 (A18). A student's account change takes effect only after staff compared
 * it with the 통장사본, and the old account stays in use until then. Approving needs the
 * "확인했어요" box; rejecting needs a reason the student will read. Shows the masked number only,
 * never the full one. Pure display: the decision goes out, the page sends it.
 */
@Component({
  selector: 'app-bank-review',
  imports: [Button, Card],
  template: `
    <app-card heading="지원금 계좌 변경 요청">
      <span cardAction class="tag">승인 대기</span>
      <dl class="facts">
        <div>
          <dt>요청한 계좌</dt>
          <dd>
            <strong>{{ pending().bankName }} · •••• {{ pending().last4 }}</strong>
          </dd>
        </div>
        <div>
          <dt>지금 쓰는 계좌</dt>
          <dd>
            {{ current() ? current()!.bankName + ' · •••• ' + current()!.last4 : '없음 (첫 등록)' }}
          </dd>
        </div>
        <div>
          <dt>요청 일시</dt>
          <dd>{{ requestedAt() }}</dd>
        </div>
        <div>
          <dt>통장사본</dt>
          <dd>
            @if (pending().bankbook; as book) {
              {{ book.name }}
              @if (canDecide()) {
                <a
                  class="open"
                  [href]="'/api/files/' + book.fileId"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  열기 ↗<span class="sr-only"> (새 창)</span>
                </a>
              }
            } @else {
              <span class="muted">첨부 없음</span>
            }
          </dd>
        </div>
      </dl>
      <p class="note">승인하기 전까지는 지금 쓰는 계좌로 지급돼요.</p>

      @if (canDecide()) {
        @if (!rejecting()) {
          <label class="check">
            <input
              type="checkbox"
              [checked]="checked()"
              [disabled]="busy()"
              (change)="checked.set($any($event.target).checked)"
            />
            통장사본의 은행·계좌번호·예금주(본인 명의)가 요청 내용과 같은지 확인했어요
          </label>
        } @else {
          <label class="reason-label" for="bank-reject-note">반려 사유 · 필수</label>
          <textarea
            id="bank-reject-note"
            rows="3"
            [attr.maxlength]="noteMax"
            [disabled]="busy()"
            [value]="note()"
            (input)="note.set($any($event.target).value)"
            placeholder="예: 통장사본의 계좌번호와 입력한 계좌번호가 달라요. 확인한 뒤 다시 요청해주세요."
          ></textarea>
          <p class="help">교육생에게 보이는 내용이에요. 무엇을 고쳐야 하는지 적어주세요.</p>
        }
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
        <div class="actions">
          @if (!rejecting()) {
            <button
              appButton
              variant="secondary"
              type="button"
              [disabled]="busy()"
              (click)="rejecting.set(true)"
            >
              반려
            </button>
            <button appButton type="button" [disabled]="busy() || !checked()" (click)="approve()">
              {{ busy() ? '처리 중…' : '계좌 승인' }}
            </button>
          } @else {
            <button
              appButton
              variant="secondary"
              type="button"
              [disabled]="busy()"
              (click)="cancelReject()"
            >
              취소
            </button>
            <button appButton type="button" [disabled]="busy() || !noteValid()" (click)="reject()">
              {{ busy() ? '처리 중…' : '반려 확정' }}
            </button>
          }
        </div>
      } @else {
        <p class="note" role="note">계좌 변경 승인은 운영·회계 담당자만 할 수 있어요.</p>
      }
    </app-card>
  `,
  styles: `
    :host {
      display: block;
    }

    .tag {
      padding: 2px var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-blue-bg);
      color: var(--color-blue);
      font-size: var(--font-size-caption);
    }

    .facts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2) var(--space-3);
      margin: 0 0 var(--space-2);
    }

    .facts div {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    dt {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }

    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .open {
      margin-left: var(--space-1);
      color: var(--color-teal);
      font-weight: var(--font-weight-medium);
      text-decoration: none;
    }

    .open:hover,
    .open:focus-visible {
      text-decoration: underline;
    }

    .muted,
    .note,
    .help {
      color: var(--color-muted);
    }

    p {
      margin: 0 0 var(--space-2);
    }

    .note,
    .help {
      font-size: var(--font-size-caption);
    }

    .check {
      display: flex;
      align-items: flex-start;
      gap: var(--space-1);
      padding: var(--space-2);
      border-radius: var(--radius-md);
      background: var(--color-mint);
      cursor: pointer;
    }

    .check input {
      flex: none;
      width: 18px;
      height: 18px;
      margin-top: 2px;
      accent-color: var(--color-teal);
    }

    .reason-label {
      display: block;
      margin-bottom: var(--space-1);
      font-weight: var(--font-weight-medium);
    }

    textarea {
      box-sizing: border-box;
      width: 100%;
      padding: var(--space-2);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-md);
      font: inherit;
      resize: vertical;
    }

    .error {
      margin-top: var(--space-2);
      color: var(--color-red);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
      margin-top: var(--space-2);
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }

    @media (max-width: 600px) {
      .facts {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class BankReview {
  readonly pending = input.required<NonNullable<UserRecordView['bankPending']>>();
  /** The account in use now, if any */
  readonly current = input<UserRecordView['bank']>(null);
  /** Operator and accountant decide; admin only looks */
  readonly canDecide = input(false);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly decide = output<BankDecision>();

  protected readonly noteMax = BANK_NOTE_MAX;
  protected readonly checked = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly note = signal('');
  protected readonly requestedAt = computed(() => dotDateTime(this.pending().requestedAt));
  protected readonly noteValid = computed(() => {
    const length = [...this.note().trim()].length;
    return length > 0 && length <= BANK_NOTE_MAX;
  });

  protected approve(): void {
    if (this.checked() && !this.busy()) {
      this.decide.emit({ requestId: this.pending().requestId, decision: 'approved' });
    }
  }

  protected reject(): void {
    if (this.noteValid() && !this.busy()) {
      this.decide.emit({
        requestId: this.pending().requestId,
        decision: 'rejected',
        note: this.note().trim(),
      });
    }
  }

  protected cancelReject(): void {
    this.rejecting.set(false);
    this.note.set('');
  }
}
