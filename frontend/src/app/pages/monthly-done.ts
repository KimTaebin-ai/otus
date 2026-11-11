import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { dotDateTime } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { StatusBadge } from '@otus/shared/ui/status-badge';
import { DOC_TYPE_LABELS, Submission, SubmissionStatus } from '../core/api.models';

/**
 * U04 done screen (final U04-monthly-done.png), shown inside /submit once the month's monthly
 * is submitted. `status` is the newest of the monthly and its supplements.
 *
 * Not in final: "접수 번호" (api.md has no such field) is left out, so the summary has 3 rows.
 * The copy for statuses other than pending_review reuses the home hero wording (HomeSubmitted).
 */
@Component({
  selector: 'app-monthly-done',
  imports: [Button, RouterLink, StatusBadge],
  template: `
    <section class="card">
      <span class="mark">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
      <h1>{{ name() }}님, 서류가 잘 도착했어요!</h1>
      <p class="body">
        @for (line of body(); track line) {
          {{ line }}<br />
        }
      </p>
      <app-status-badge [status]="status()" />

      <dl>
        <div>
          <dt>제출 월</dt>
          <dd>{{ month() }}</dd>
        </div>
        <div>
          <dt>제출 서류</dt>
          <dd>{{ docs() }}</dd>
        </div>
        <div>
          <dt>제출일시</dt>
          <dd>{{ submittedAt() }}</dd>
        </div>
      </dl>

      <ol class="steps" aria-label="진행 단계">
        <li class="on"><span class="tick">✓</span>제출 완료</li>
        <li class="chev" aria-hidden="true">›</li>
        <li [class.on]="step() >= 2">
          <span class="tick">{{ step() > 2 ? '✓' : '02' }}</span
          >운영팀 확인
        </li>
        <li class="chev" aria-hidden="true">›</li>
        <li [class.on]="step() >= 3">
          <span class="tick">{{ step() >= 3 ? '✓' : '03' }}</span
          >서류 승인
        </li>
      </ol>

      <div class="actions">
        <button appButton variant="secondary" type="button" routerLink="/home">홈으로</button>
        <button appButton type="button" routerLink="/history">내가 낸 서류 보기</button>
      </div>
    </section>
    <p class="foot">추가로 필요한 내용이 있으면, 어떤 부분인지 알아보기 쉽게 안내해드릴게요.</p>
  `,
  styleUrl: './monthly-done.css',
})
export class MonthlyDone {
  readonly name = input.required<string>();
  /** The submitted monthly (summary rows) */
  readonly monthly = input.required<Submission>();
  readonly status = input.required<SubmissionStatus>();

  protected readonly month = computed(() => {
    const [year, m] = this.monthly().target_month.split('-');
    return `${year}년 ${Number(m)}월`;
  });
  protected readonly docs = computed(() => {
    const types = this.monthly().required_doc_types;
    return types.length === 1 ? `${DOC_TYPE_LABELS[types[0]]} 1개` : `서류 ${types.length}개`;
  });
  protected readonly submittedAt = computed(() => dotDateTime(this.monthly().submitted_at));
  /** 1 제출 완료, 2 운영팀 확인 중, 3 서류 승인 */
  protected readonly step = computed(() => (this.status() === 'approved' ? 3 : 2));
  protected readonly body = computed(() => {
    switch (this.status()) {
      case 'approved':
        return ['서류가 승인됐어요.', '수령 대상은 시간 요건 판정과 함께 운영팀이 확정해요.'];
      case 'resubmitted':
        return [
          '이제 운영팀이 다시 확인할 차례예요.',
          '진행 상황은 ‘내가 낸 서류’에서 볼 수 있어요.',
        ];
      default:
        return ['이제 운영팀이 확인할 차례예요.', '진행 상황은 ‘내가 낸 서류’에서 볼 수 있어요.'];
    }
  });
}
