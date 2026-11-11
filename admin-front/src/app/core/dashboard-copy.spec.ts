import { DashboardView } from './admin.models';
import {
  dashboardCards,
  employedHeading,
  hoursLine,
  previousLines,
  taskRows,
} from './dashboard-copy';

const VIEW: DashboardView = {
  month: '2026-10',
  targets: 100,
  employedExcluded: 3,
  unsubmitted: 10,
  pendingReview: 14,
  revisionRequested: 6,
  hours: {
    inProgress: 128,
    projected: [
      { tier: 'tier_2', seconds: 288000, count: 12 },
      { tier: 'tier_1', seconds: 144000, count: 31 },
    ],
  },
  previous: {
    month: '2026-09',
    awaitingDecision: 0,
    met: 74,
    notMet: 20,
    onHold: 8,
    eligible: 70,
    notEligible: 2,
    undecided: 30,
  },
  tasks: { bankChangePending: 1, sendFailed: 1 },
};

describe('dashboard copy', () => {
  it('writes the four cards with student wording', () => {
    expect(dashboardCards(VIEW)).toEqual([
      { label: '제출 대상', value: '100명', sub: '취업 중 3명 제외' },
      { label: '미제출', value: '10명', sub: '임시 저장 포함 · 취업 중 제외' },
      { label: '검토 대기', value: '14명', sub: '제출 완료' },
      { label: '재검토 요청', value: '6명', sub: '재제출 대기' },
    ]);
  });

  it('says who is left out of the notice', () => {
    expect(employedHeading(VIEW)).toBe('취업 중 3명은 제출 안내에서 제외돼요');
  });

  it('writes the month being counted with 달성(예상), thresholds from the data, lowest first', () => {
    expect(hoursLine(VIEW)).toBe(
      '10월 집계 중 128명 · 40시간 달성(예상) 31명 · 80시간 달성(예상) 12명',
    );
    expect(
      hoursLine({
        ...VIEW,
        hours: { inProgress: 1, projected: [{ tier: 'tier_1', seconds: 126000, count: 1 }] },
      }),
    ).toBe('10월 집계 중 1명 · 35시간 달성(예상) 1명');
  });

  it('writes the month before as a result line and a final line', () => {
    expect(previousLines(VIEW)).toEqual([
      '9월 시간 요건 판정 · 충족 74명 · 미충족 20명 · 판단 보류 8명',
      '9월 최종 수령 대상 · 수령 대상 70명 · 수령 대상 아님 2명 · 확정 전 30명',
    ]);
  });

  it('adds 판정 대기 only while a decision is pending', () => {
    const lines = previousLines({ ...VIEW, previous: { ...VIEW.previous, awaitingDecision: 5 } });
    expect(lines[0]).toContain('판정 대기 5명 · 충족');
  });

  it('never puts 달성(예상) and 확정 in one sentence, or 예상 in a decided line', () => {
    const all = [hoursLine(VIEW), ...previousLines(VIEW), employedHeading(VIEW)];
    for (const line of all) {
      expect(line.includes('달성(예상)') && line.includes('확정')).toBe(false);
    }
    for (const line of previousLines(VIEW)) {
      expect(line).not.toContain('예상');
      expect(line).not.toContain('달성');
    }
    expect(hoursLine(VIEW)).not.toContain('확정');
    expect(hoursLine(VIEW)).not.toContain('판정');
  });

  it('lists only 정보 변경 (계좌) and 발송 실패, no 유예 or 개명', () => {
    const rows = taskRows(VIEW);
    expect(rows).toEqual([
      { label: '정보 변경', count: '1건', basis: '계좌 1건' },
      { label: '발송 실패', count: '1건', basis: '실패 대상만 재시도' },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/유예|개명/);
  });
});
