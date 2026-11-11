import { NoticeChannel, noticeChannelLabel } from './notice-channel';
import { NoticeAudience, audienceLabel, studyHoursNotice } from '@otus/shared/core/notice-audience';
import { hourMinute, lastMoment, monthDay, monthNumber } from '@otus/shared/core/format';
import { NoticeSendResult, NoticeView } from './admin.models';

/**
 * Screen copy for A07 (docs/design/README.md "관리자"). The notice text is the student bell's
 * ("{M}월 서류, 준비하고 계신가요?"); in-app delivery is always available, with optional SMTP delivery.
 */

export interface NoticeCardCopy {
  label: string;
  value: string;
  sub: string;
  tone: 'default' | 'mint';
}

export function noticeCards(v: NoticeView): NoticeCardCopy[] {
  return [
    {
      label: v.audience === 'unsubmitted' ? '이번 달 미제출' : audienceLabel(v.audience),
      value: String(v.matched),
      sub:
        v.audience === 'unsubmitted'
          ? '임시 저장·취업 중인 사용자 포함'
          : '최근 월별 집계 · 취업 중인 사용자 포함',
      tone: 'default',
    },
    {
      label: '취업 중 · 자동 제외',
      value: String(v.employedExcluded),
      sub: '사용자 설정의 취업 상태 기준',
      tone: 'default',
    },
    {
      label: '알림 발송 대상',
      value: String(v.targets.length),
      sub:
        v.audience === 'unsubmitted'
          ? '취업 중인 분과 제출 완료자 제외'
          : '취업 중인 분 제외 · 제출 여부 무관',
      tone: 'mint',
    },
  ];
}

export const NOTICE_CHANNEL = '앱 내부 알림';
export const NOTICE_LINK = '이번 달 서류 제출하기';

/** "9월 서류, 준비하고 계신가요?" (same as frontend/src/app/layout/notifications.ts) */
export function noticeTitle(month: string, audience: NoticeAudience = 'unsubmitted'): string {
  if (audience !== 'unsubmitted') return studyHoursNotice(month, audienceHours(audience)).title;
  return `${monthNumber(month)}월 서류, 준비하고 계신가요?`;
}

/** Paragraphs of the notice. The deadline is the server's closes_at shown through lastMoment(). */
export function noticeBody(
  month: string,
  closesAt: string | null,
  audience: NoticeAudience = 'unsubmitted',
): string[][] {
  if (audience !== 'unsubmitted') return [studyHoursNotice(month, audienceHours(audience)).lines];
  const m = monthNumber(month);
  const last = lastMoment(closesAt);
  return [
    [`${m}월 고용보험가입내역서를 준비해주세요.`, `${m}월 1일 이후 발급본이 필요해요.`],
    [`${monthDay(last)} ${hourMinute(last)}까지 PDF로 올려주세요.`],
  ];
}

/** What the empty state says: everyone unsubmitted is 취업 중. */
export function emptyReason(v: NoticeView): string[] {
  if (v.audience !== 'unsubmitted') return ['선택한 시간 구간에 해당하는 발송 대상이 없어요.'];
  if (!v.unsubmitted) return ['현재 안내가 필요한 미제출자가 없어요.'];
  return [
    `아직 제출하지 않은 ${v.unsubmitted}명은 모두 취업 중이에요.`,
    '이분들께는 미제출 안내를 보내지 않아요.',
  ];
}

/** Under the target list: who is not getting the notice and why */
export function skippedCopy(v: NoticeView): { head: string; names: string; note: string } {
  return {
    head: `취업 중 ${v.employedExcluded}명은 발송하지 않습니다.`,
    names: v.employedNames.join(' · '),
    note:
      v.audience === 'unsubmitted'
        ? '최종 제출을 완료한 사용자도 대상에서 제외돼요.'
        : '서류 제출 여부와 별도로 시간 구간에 따라 안내해요.',
  };
}

/** The confirm step: what is about to go out */
export function confirmCopy(
  v: NoticeView,
  channel: NoticeChannel = 'service',
): { summary: string; detail: string; rows: string[][] } {
  return {
    summary: `${monthNumber(v.month)}월 ${audienceLabel(v.audience)} 안내 · ${v.targets.length}명`,
    detail: `${noticeChannelLabel(channel)}. 발송 직전에 선택한 대상 조건과 취업 상태를 다시 확인해요.`,
    rows: [
      ['발송 채널', noticeChannelLabel(channel)],
      ['알림 제목', noticeTitle(v.month, v.audience)],
      [
        '알림 내용',
        v.audience === 'unsubmitted'
          ? channel === 'email'
            ? '필요한 서류, 제출 마감'
            : '필요한 서류, 제출 마감, 이동 버튼'
          : studyHoursNotice(v.month, audienceHours(v.audience)).lines.join(' '),
      ],
      ...(channel === 'email' ? [] : [['이동 버튼', noticeLink(v.audience)]]),
    ],
  };
}

export function sentCopy(r: NoticeSendResult): { title: string; rows: string[][] } {
  return {
    title: `${r.sent}명에게 안내를 보냈어요`,
    rows: [
      ['발송 성공', `${r.sent}명`],
      ['발송 실패', `${r.failed}명`],
      ['취업 중 · 제외', `${r.employedExcluded}명`],
    ],
  };
}

export function noticeLink(audience: NoticeAudience): string {
  return audience === 'unsubmitted' ? NOTICE_LINK : '홈으로 이동';
}

function audienceHours(audience: NoticeAudience): 0 | 40 | 80 {
  return audience === 'at_least_80' ? 80 : audience === 'hours_40_80' ? 40 : 0;
}
