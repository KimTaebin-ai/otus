import { NoticeChannel } from '../core/notice-channel';
import { Component, computed, input, output } from '@angular/core';

import { Button } from '@otus/shared/ui/button';
import { NoticeView } from '../core/admin.models';
import { confirmCopy } from '../core/notice-copy';
import { Dialog } from '../ui/dialog';

/**
 * The check before sending (final A08-notice-confirm, content only, as a modal in the newer
 * style): who and what goes out, then "발송하기". No 유예 or 개인 마감, no mail attachment line.
 */
@Component({
  selector: 'app-notice-confirm',
  imports: [Button, Dialog],
  template: `
    <app-dialog
      label="발송 전 확인"
      [dismissible]="!busy() && !uncertain()"
      (dismissed)="cancel.emit()"
    >
      <h2>대상과 내용을 확인해주세요</h2>
      <p class="lead">발송 전에 선택한 대상 조건과 취업 상태를 다시 확인해요.</p>
      <div class="summary">
        <strong>{{ copy().summary }}</strong>
        <span>{{ copy().detail }}</span>
      </div>
      @if (emailAvailable() === false) {
        <p class="foot">이메일 발송이 설정되지 않아 앱 내부 알림만 전달돼요.</p>
      }
      <dl>
        @for (row of copy().rows; track row[0]) {
          <div>
            <dt>{{ row[0] }}</dt>
            <dd>{{ row[1] }}</dd>
          </div>
        }
      </dl>
      @if (error(); as message) {
        <p role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button appButton type="button" [disabled]="busy()" (click)="send.emit()">
          {{ busy() ? '발송 결과 확인 중…' : uncertain() ? '발송 결과 다시 확인' : '발송하기' }}
        </button>
        <button
          appButton
          variant="secondary"
          type="button"
          [disabled]="busy() || uncertain()"
          (click)="cancel.emit()"
        >
          취소·내용 수정
        </button>
      </div>
      <p class="foot">
        대상이 0명이면 발송하지 않아요. 새 안내를 보내면 같은 대상에게 다시 전달돼요. 실패한
        이메일만 따로 다시 보낼 수 있어요.
      </p>
    </app-dialog>
  `,
  styles: `
    h2 {
      margin: 0 0 var(--space-1);
      font-size: var(--font-size-page-title);
      line-height: 1.3;
    }

    p {
      margin: 0;
    }

    .lead,
    .foot {
      color: var(--color-muted);
    }

    .lead {
      font-size: var(--font-size-body);
    }

    .foot {
      margin-top: var(--space-2);
      font-size: var(--font-size-caption);
    }

    .summary {
      display: flex;
      flex-direction: column;
      gap: calc(var(--space-1) / 2);
      margin-top: var(--space-3);
      padding: var(--space-alert);
      border-radius: var(--radius-md);
      background: var(--color-mint);
    }

    .summary strong {
      font-size: var(--font-size-alert-title);
      font-weight: var(--font-weight-medium);
      color: var(--color-teal);
    }

    .summary span {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }

    dl {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      margin: var(--space-3) 0;
    }

    dl div {
      display: flex;
      gap: var(--space-2);
      font-size: var(--font-size-body);
    }

    dt {
      flex: none;
      width: calc(var(--space-5) * 2);
      color: var(--color-muted);
    }

    dd {
      margin: 0;
    }

    .actions {
      display: flex;
      gap: calc(var(--space-1) * 1.5);
    }
  `,
})
export class NoticeConfirm {
  readonly view = input.required<NoticeView>();
  readonly selectedChannel = input<NoticeChannel>('service');
  readonly emailAvailable = input<boolean | null>(null);
  readonly busy = input(false);
  readonly uncertain = input(false);
  readonly error = input<string | null>(null);
  readonly send = output<void>();
  readonly cancel = output<void>();

  protected readonly copy = computed(() => confirmCopy(this.view(), this.selectedChannel()));
}
