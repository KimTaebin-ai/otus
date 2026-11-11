import { noticeChannelLabel } from '../core/notice-channel';
import { Component, computed, input, output } from '@angular/core';

import { dotDateTime } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { NoticeSendResult } from '../core/admin.models';
import { NoticeDelivery } from '../core/notices-api';
import { sentCopy } from '../core/notice-copy';
import { Dialog } from '../ui/dialog';

/** Result of a send (final A07-notice-sent): counts and the time, back to the 현황. */
@Component({
  selector: 'app-notice-sent',
  imports: [Button, Dialog],
  template: `
    <app-dialog [label]="delivery() ? '안내 발송 현황' : '발송 완료'" [dismissible]="false">
      <div class="done">
        <span class="check" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <h2>
          {{
            delivery()
              ? serviceSelected()
                ? '앱 내부 알림 ' + result().sent + '명에게 전달했어요'
                : '이메일 발송 현황'
              : copy().title
          }}
        </h2>
        <p class="lead">
          {{
            serviceSelected()
              ? '교육생 화면 상단의 알림 벨에서 안내를 확인할 수 있어요.'
              : '선택한 대상의 이메일 발송 상태를 확인해주세요.'
          }}
        </p>
      </div>
      <dl>
        @for (row of rows(); track row[0]) {
          <div>
            <dt>{{ row[0] }}</dt>
            <dd>{{ row[1] }}</dd>
          </div>
        }
      </dl>
      @if (emailSelected() && delivery(); as progress) {
        <h3>이메일 발송 현황</h3>
        <dl aria-live="polite">
          <div>
            <dt>발송 대기</dt>
            <dd>{{ progress.email.pending }}명</dd>
          </div>
          <div>
            <dt>전송 중</dt>
            <dd>{{ progress.email.sending }}명</dd>
          </div>
          <div>
            <dt>이메일 서버 수락</dt>
            <dd>{{ progress.email.sent }}명</dd>
          </div>
          <div>
            <dt>발송 실패</dt>
            <dd>{{ progress.email.failed }}명</dd>
          </div>
          <div>
            <dt>대상 변경 · 제외</dt>
            <dd>{{ progress.email.skipped }}명</dd>
          </div>
        </dl>
        <p class="foot">
          이메일 서버에서 수락한 건수예요. 받은편지함 도착 여부는 확인할 수 없어요.
        </p>
        @for (message of emailIssues(); track message) {
          <p class="foot" role="status">{{ message }}</p>
        }
        @if (emailAvailable() === false) {
          <p class="foot" role="status">
            이메일 발송이 설정되지 않았어요. 설정 후 실패한 이메일을 다시 보낼 수 있어요.
          </p>
        }
        @if (statusError(); as message) {
          <p role="alert">발송 상태를 불러오지 못했어요. {{ message }}</p>
          <button appButton variant="secondary" type="button" (click)="refreshStatus.emit()">
            상태 다시 확인
          </button>
        }
        @if (error(); as message) {
          <p role="alert">{{ message }}</p>
        }
        @if (retryConfirm()) {
          <p class="foot">
            현재도 안내 대상인 실패 수신자에게 이메일을 다시 보내요. 앱 내부 알림은 다시 보내지
            않아요.
          </p>
          @if (deliveryUnknown()) {
            <p class="foot">
              이전 이메일의 수락 여부를 확인하지 못했어요. 이미 받은 분에게 다시 전달될 수 있어요.
            </p>
          }
          <div class="actions">
            <button appButton type="button" [disabled]="busy()" (click)="retry.emit()">
              {{
                busy()
                  ? '재시도 결과 확인 중…'
                  : retryUncertain()
                    ? '재시도 결과 다시 확인'
                    : '이메일 재시도 확정'
              }}
            </button>
            <button
              appButton
              variant="secondary"
              type="button"
              [disabled]="busy() || retryUncertain()"
              (click)="cancelRetry.emit()"
            >
              취소
            </button>
          </div>
        } @else if (progress.email.failed > 0 && !retryClosed()) {
          <button
            appButton
            variant="secondary"
            type="button"
            [disabled]="busy() || emailAvailable() === false"
            (click)="reviewRetry.emit()"
          >
            실패한 이메일 다시 보내기
          </button>
        }
      }
      <button
        appButton
        type="button"
        class="wide"
        [disabled]="busy() || retryUncertain()"
        (click)="done.emit()"
      >
        {{ delivery() ? '확인 · 안내 화면으로' : '제출 현황으로 돌아가기' }}
      </button>
    </app-dialog>
  `,
  styles: `
    .done {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1);
      text-align: center;
    }

    .check {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: calc(var(--size-icon-box) + var(--space-1) + var(--space-1) / 2);
      height: calc(var(--size-icon-box) + var(--space-1) + var(--space-1) / 2);
      border-radius: 50%;
      background: var(--color-mint);
    }

    svg {
      width: var(--size-icon);
      height: var(--size-icon);
      fill: none;
      stroke: var(--color-teal);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    h2 {
      margin: var(--space-2) 0 0;
      font-size: var(--font-size-page-title);
      line-height: 1.3;
    }

    p {
      margin: 0;
      color: var(--color-muted);
    }

    .lead {
      margin-top: var(--space-2);
      font-size: var(--font-size-body);
    }

    dl {
      display: flex;
      flex-direction: column;
      gap: calc(var(--space-1) * 1.5);
      margin: var(--space-3) 0 calc(var(--space-2) + var(--space-1) / 2);
      padding: var(--space-alert) var(--space-3);
      border-radius: var(--radius-md);
      background: var(--color-bg);
    }

    dl div {
      display: flex;
      justify-content: space-between;
      font-size: var(--font-size-body);
      line-height: var(--space-3);
    }

    dt {
      color: var(--color-muted);
    }

    dd {
      margin: 0;
      font-weight: var(--font-weight-medium);
    }

    .foot {
      margin-bottom: var(--space-2);
      font-size: var(--font-size-caption);
      text-align: center;
    }

    .wide {
      width: 100%;
      height: var(--height-button-lg);
    }
    .actions {
      display: flex;
      gap: var(--space-1);
      margin-bottom: var(--space-2);
    }
    [role='alert'] {
      color: var(--color-danger, #a53333);
      margin-bottom: var(--space-2);
    }
  `,
})
export class NoticeSent {
  readonly result = input.required<NoticeSendResult>();
  readonly delivery = input<NoticeDelivery | null>(null);
  readonly emailAvailable = input<boolean | null>(null);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly statusError = input<string | null>(null);
  readonly retryConfirm = input(false);
  readonly retryUncertain = input(false);
  readonly retryClosed = input(false);
  readonly done = output<void>();
  readonly reviewRetry = output<void>();
  readonly cancelRetry = output<void>();
  readonly retry = output<void>();
  readonly refreshStatus = output<void>();

  protected readonly serviceSelected = computed(() => this.delivery()?.channel !== 'email');
  protected readonly emailSelected = computed(() => this.delivery()?.channel !== 'service');
  protected readonly copy = computed(() => sentCopy(this.result()));
  protected readonly rows = computed(() => [
    ...(this.delivery()
      ? [
          ['발송 채널', noticeChannelLabel(this.delivery()?.channel ?? 'both')],
          ...(this.serviceSelected()
            ? [
                ['앱 내부 알림 전달', `${this.result().sent}명`],
                ['앱 내부 알림 실패', `${this.result().failed}명`],
              ]
            : []),
          ['취업 중 · 제외', `${this.result().employedExcluded}명`],
        ]
      : this.copy().rows),
    ['발송 시각', dotDateTime(this.result().sentAt)],
  ]);
  protected readonly deliveryUnknown = computed(
    () =>
      this.delivery()?.recipients?.some(
        (recipient) => recipient.last_error_code === 'delivery_unknown',
      ) ?? false,
  );
  protected readonly emailIssues = computed(() => {
    const messages: Record<string, string> = {
      smtp_not_configured: '이메일 발송이 설정되지 않아 전달하지 못했어요.',
      smtp_failed: '이메일 서버에서 발송을 완료하지 못했어요. 실패한 이메일을 다시 보낼 수 있어요.',
      delivery_unknown: '전송이 중단되어 이메일 수락 여부를 확인하지 못한 대상이 있어요.',
      cycle_closed: '접수가 마감되어 대기 중인 이메일을 보내지 않았어요.',
      no_longer_target:
        '선택한 대상 조건이나 취업 상태가 바뀐 대상에게는 이메일을 보내지 않았어요.',
      recipient_changed: '이메일 주소가 바뀐 대상은 새 안내에서 다시 확인해주세요.',
      invalid_recipient: '이메일 주소를 구성할 수 없는 대상이 있어요.',
    };
    return [
      ...new Set(
        (this.delivery()?.recipients ?? [])
          .map((recipient) =>
            recipient.last_error_code ? messages[recipient.last_error_code] : undefined,
          )
          .filter((message): message is string => !!message),
      ),
    ];
  });
}
