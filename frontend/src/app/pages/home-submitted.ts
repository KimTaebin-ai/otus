import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { RouterLink } from '@angular/router';

import {
  dotMonthDay,
  hourMinute,
  lastMoment,
  monthDay,
  monthNumber,
  spokenTime,
} from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { StatusBadge } from '@otus/shared/ui/status-badge';
import { Cycle, Submission, SubmissionKind } from '../core/api.models';
import { RevisionPath } from '../core/revision';
import { AuthService } from '../core/auth.service';
import { ApiService } from '../core/api.service';
import { accountText, employmentText } from '../core/profile';
import { formatMonth } from '../layout/shell';
import { ProfileCard } from './profile-card';
import { HoursHero } from './hours-hero';

interface HeroCopy {
  title: string;
  body: string[];
  /** Pill next to "이번 달 제출을 마쳤어요" */
  tag: string;
  action: string;
  /** Where the hero button goes */
  link: string;
}

const KIND_ROW_LABELS: Record<SubmissionKind, string> = {
  initial: '최초',
  monthly: '월별',
  supplement: '보완',
};

const SUBMITTED_BODY = [
  '이제 운영팀이 확인할게요.',
  '진행 상황은 ‘내가 낸 서류’에서 볼 수 있어요.',
];

/**
 * U03 홈, this month submitted (final U03-home-submitted.png). The hero copy and tag follow
 * the submission's status. Hidden (out of scope): the "서류 준비가 막막할 때" card.
 */
@Component({
  selector: 'app-home-submitted',
  imports: [Button, Card, ProfileCard, RouterLink, StatusBadge, HoursHero],
  templateUrl: './home-submitted.html',
  styleUrl: './home-submitted.css',
})
export class HomeSubmitted {
  readonly cycle = input.required<Cycle>();
  readonly current = input.required<Submission>();
  readonly recent = input.required<Submission[]>();
  /** Where the revision request is answered: the monthly screen or the 최초 4종 one */
  readonly revisionLink = input<RevisionPath>('/submit');

  protected readonly me = inject(AuthService).me;
  protected readonly employment = computed(() => employmentText(this.me()));
  /** "카카오뱅크 · •••• 1234", as in final */
  private readonly bank = toSignal(
    inject(ApiService)
      .bankAccount()
      .pipe(catchError(() => of(null))),
    { initialValue: null },
  );
  protected readonly account = computed(() => accountText(this.bank(), ' · '));

  protected readonly hero = computed((): HeroCopy => {
    const s = this.current();
    const month = monthNumber(s.target_month);
    const action = '제출한 서류 보기 →';
    const link = '/history';
    switch (s.status) {
      case 'revision_requested':
        return {
          title: '보완이 필요한 서류가 있어요',
          body: ['운영팀이 남긴 사유를 확인하고 새 파일로 다시 올려주세요.'],
          tag: '서류 보완 필요',
          action: '보완 제출하기 →',
          link: this.revisionLink(),
        };
      case 'resubmitted':
        return {
          title: '보완 서류가 잘 도착했어요',
          body: ['운영팀이 다시 확인할게요.'],
          tag: '재검토 대기',
          action,
          link,
        };
      case 'approved':
        return {
          title: `${month}월 서류 확인이 끝났어요`,
          body: ['서류가 승인됐어요.', '수령 대상은 시간 요건 판정과 함께 운영팀이 확정해요.'],
          tag: '서류 승인',
          action,
          link,
        };
      default:
        return {
          title:
            s.kind === 'initial'
              ? `첫 서류 ${s.files.length}개, 잘 도착했어요`
              : `${month}월 서류가 잘 도착했어요`,
          body: SUBMITTED_BODY,
          tag: '서류 확인 중',
          action,
          link,
        };
    }
  });

  protected readonly hasMonthly = computed(() => this.recent().some((s) => s.kind !== 'initial'));

  protected readonly formatMonth = formatMonth;
  protected readonly monthDay = monthDay;
  protected readonly hourMinute = hourMinute;
  protected readonly lastMoment = lastMoment;
  protected readonly dotMonthDay = dotMonthDay;
  protected readonly spokenTime = spokenTime;

  /** "2026년 9월 · 최초 서류 4종" (final); monthly/supplement follow the same pattern. */
  protected rowTitle(s: Submission): string {
    return `${formatMonth(s.target_month)} · ${KIND_ROW_LABELS[s.kind]} 서류 ${s.files.length}종`;
  }
}
