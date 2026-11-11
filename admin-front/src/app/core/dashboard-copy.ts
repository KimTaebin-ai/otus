import { hoursText, monthNumber } from '@otus/shared/core/format';
import { DashboardView } from './admin.models';

/**
 * Screen copy for A00. Wording rule (docs/design/README.md "관리자"): "달성(예상)" is only for
 * the month being counted, "확정" only for the final 수령 대상; they never share a sentence.
 */

export interface StatCardCopy {
  label: string;
  value: string;
  sub: string;
}

export function dashboardCards(v: DashboardView): StatCardCopy[] {
  return [
    { label: '제출 대상', value: `${v.targets}명`, sub: `취업 중 ${v.employedExcluded}명 제외` },
    { label: '미제출', value: `${v.unsubmitted}명`, sub: '임시 저장 포함 · 취업 중 제외' },
    { label: '검토 대기', value: `${v.pendingReview}명`, sub: '제출 완료' },
    { label: '재검토 요청', value: `${v.revisionRequested}명`, sub: '재제출 대기' },
  ];
}

/** Heading of the mint box: who is left out of the 제출 안내 */
export function employedHeading(v: DashboardView): string {
  return `취업 중 ${v.employedExcluded}명은 제출 안내에서 제외돼요`;
}

/** "10월 집계 중 128명 · 40시간 달성(예상) 31명 · 80시간 달성(예상) 12명" */
export function hoursLine(v: DashboardView): string {
  const tiers = [...v.hours.projected]
    .sort((a, b) => a.seconds - b.seconds)
    .map((t) => `${hoursText(t.seconds)} 달성(예상) ${t.count}명`);
  return [`${monthNumber(v.month)}월 집계 중 ${v.hours.inProgress}명`, ...tiers].join(' · ');
}

/** The month before, as two lines: the time requirement's result, then the final 수령 대상. */
export function previousLines(v: DashboardView): string[] {
  const p = v.previous;
  const m = monthNumber(p.month);
  const result = [
    ...(p.awaitingDecision ? [`판정 대기 ${p.awaitingDecision}명`] : []),
    `충족 ${p.met}명`,
    `미충족 ${p.notMet}명`,
    `판단 보류 ${p.onHold}명`,
  ];
  const final = [
    `수령 대상 ${p.eligible}명`,
    `수령 대상 아님 ${p.notEligible}명`,
    `확정 전 ${p.undecided}명`,
  ];
  return [
    `${m}월 시간 요건 판정 · ${result.join(' · ')}`,
    `${m}월 최종 수령 대상 · ${final.join(' · ')}`,
  ];
}

export interface TaskRowCopy {
  label: string;
  count: string;
  basis: string;
}

/** 오늘 확인할 업무. 개별 유예와 개명 rows are not in v1.0. */
export function taskRows(v: DashboardView): TaskRowCopy[] {
  return [
    {
      label: '정보 변경',
      count: `${v.tasks.bankChangePending}건`,
      basis: `계좌 ${v.tasks.bankChangePending}건`,
    },
    { label: '발송 실패', count: `${v.tasks.sendFailed}건`, basis: '실패 대상만 재시도' },
  ];
}
