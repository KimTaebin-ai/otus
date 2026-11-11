import { studyHoursNotice } from '@otus/shared/core/notice-audience';
import {
  dotDateTime,
  hourMinute,
  lastMoment,
  monthDay,
  monthNumber,
} from '@otus/shared/core/format';
import { AppNotification, Cycle } from './api.models';

export interface NotificationCopy {
  meta: string;
  title: string;
  lines: string[];
  action: string;
  link: string;
}

/** Never apply today's deadline or submission link to a historical reminder. */
export function notificationCopy(
  notice: AppNotification,
  cycle: Cycle | null,
  initialSubmitted: boolean,
): NotificationCopy {
  const data = notice.data ?? {};
  const month = data.month ? `${monthNumber(data.month)}월` : '이번 달';
  const current = !!cycle && data.month === cycle.target_month;
  const base = {
    meta: `앱 알림 · ${dotDateTime(notice.created_at)}`,
    title: '새 알림이 도착했어요',
    lines: ['앱에서 자세한 내용을 확인해주세요.'],
    action: '홈으로 이동 →',
    link: initialSubmitted ? '/home' : '/initial',
  };
  switch (notice.kind) {
    case 'admin_notice':
      return {
        ...base,
        meta: `운영팀 알림 · ${dotDateTime(notice.created_at)}`,
        title: data.title ?? base.title,
        lines: (data.body ?? '').split(/\r?\n/),
      };
    case 'submission_reminder':
    case 'submission_period_opened': {
      const accepting = current && cycle.state === 'open';
      const last = accepting ? lastMoment(cycle.closes_at) : null;
      return {
        ...base,
        meta: `서류 제출 안내 · ${dotDateTime(notice.created_at)}`,
        title: `${month} 서류, 준비하고 계신가요?`,
        lines: accepting
          ? [
              initialSubmitted
                ? `${month} 고용보험가입내역서를 준비해주세요.`
                : '최초 등록에 필요한 서류 4종을 준비해주세요.',
              `${monthDay(cycle.issued_after + 'T00:00:00')} 이후 발급된 고용보험가입내역서가 필요해요.`,
              `${monthDay(last)} ${hourMinute(last)}까지 PDF로 올려주세요.`,
            ]
          : [`${month} 서류 제출 안내가 도착했어요.`, '접수 일정과 제출 상태를 확인해주세요.'],
        action: !initialSubmitted
          ? '첫 서류 등록하기 →'
          : accepting
            ? '이번 달 서류 제출하기 →'
            : '제출 이력 보기 →',
        link: !initialSubmitted ? '/initial' : accepting ? '/submit' : '/history',
      };
    }
    case 'submission_revision_requested':
      return {
        ...base,
        title: `${month} 서류 보완이 필요해요`,
        lines: ['검토 의견과 보완할 서류를 제출 이력에서 확인해주세요.'],
        action: '제출 이력 보기 →',
        link: '/history',
      };
    case 'submission_approved':
      return {
        ...base,
        title: `${month} 서류가 승인됐어요`,
        lines: ['서류 검토가 완료됐어요. 최종 수령 대상 여부는 별도로 확인해주세요.'],
        action: '제출 이력 보기 →',
        link: '/history',
      };
    case 'bank_account_approved':
      return {
        ...base,
        title: '계좌 변경이 승인됐어요',
        lines: ['내 정보에서 지급 계좌를 확인해주세요.'],
        action: '내 정보 보기 →',
        link: '/settings',
      };
    case 'bank_account_rejected':
      return {
        ...base,
        title: '계좌 변경 요청이 반려됐어요',
        lines: [data.decision_note ?? '', '새 통장사본으로 다시 요청할 수 있어요.'].filter(Boolean),
        action: '계좌 다시 요청하기 →',
        link: '/settings',
      };
    case 'study_hours_notice':
      if (!data.month || ![0, 40, 80].includes(data.study_hours as number)) return base;
      return {
        ...base,
        ...studyHoursNotice(data.month, data.study_hours!),
        meta: `지원금 시간 요건 안내 · ${dotDateTime(notice.created_at)}`,
      };
    case 'hours_projected':
      return {
        ...base,
        title: `${month} 시간 요건 달성이 예상돼요`,
        lines: [
          '현재 집계와 월말 판정 일정을 홈에서 확인해주세요. 최종 수령 대상 판정과는 별개예요.',
        ],
      };
    case 'time_requirement_decided':
      return {
        ...base,
        title: `${month} 시간 요건 판정이 나왔어요`,
        lines: ['시간 요건 판정 결과를 홈에서 확인해주세요. 최종 수령 대상 판정과는 별개예요.'],
      };
    case 'final_decided':
      return {
        ...base,
        title: `${month} 최종 수령 대상 판정이 나왔어요`,
        lines: ['홈에서 최종 판정 결과를 확인해주세요.'],
      };
    default:
      return base;
  }
}
