import { NoticeSendResult, NoticeView } from './admin.models';
import {
  NOTICE_CHANNEL,
  confirmCopy,
  emptyReason,
  noticeBody,
  noticeCards,
  noticeTitle,
  sentCopy,
  skippedCopy,
} from './notice-copy';

const VIEW: NoticeView = {
  month: '2026-09',
  months: ['2026-09', '2026-10'],
  audience: 'unsubmitted',
  matched: 10,
  hoursUnknown: 0,
  unsubmitted: 10,
  employedExcluded: 3,
  employedNames: ['박서진', '최시우', '서지민'],
  targets: Array.from({ length: 7 }, (_, i) => ({
    name: `사용자${i}`,
    login: `user${i}`,
    employed: false,
    status: 'missing' as const,
  })),
  closesAt: '2026-10-01T00:00:00+09:00',
};

describe('notice copy', () => {
  it('writes the three cards; the last is mint and counts the targets', () => {
    expect(noticeCards(VIEW).map((c) => [c.label, c.value, c.tone])).toEqual([
      ['이번 달 미제출', '10', 'default'],
      ['취업 중 · 자동 제외', '3', 'default'],
      ['알림 발송 대상', '7', 'mint'],
    ]);
  });

  it('uses the student bell title', () => {
    expect(noticeTitle('2026-09')).toBe('9월 서류, 준비하고 계신가요?');
  });

  it('writes the body with the deadline from closes_at (last moment, 23:59), no help sentence', () => {
    expect(noticeBody('2026-09', '2026-10-01T00:00:00+09:00')).toEqual([
      ['9월 고용보험가입내역서를 준비해주세요.', '9월 1일 이후 발급본이 필요해요.'],
      ['9월 30일 23:59까지 PDF로 올려주세요.'],
    ]);
    expect(JSON.stringify(noticeBody('2026-09', VIEW.closesAt))).not.toContain('도움말');
    // "10월 1일" would be the raw exclusive closes_at: a bug
    expect(JSON.stringify(noticeBody('2026-09', VIEW.closesAt))).not.toContain('10월 1일');
  });

  it('says why nothing goes out when every unsubmitted user is 취업 중', () => {
    expect(emptyReason({ ...VIEW, unsubmitted: 3, targets: [] })).toEqual([
      '아직 제출하지 않은 3명은 모두 취업 중이에요.',
      '이분들께는 미제출 안내를 보내지 않아요.',
    ]);
  });

  it('lists who is skipped', () => {
    expect(skippedCopy(VIEW)).toEqual({
      head: '취업 중 3명은 발송하지 않습니다.',
      names: '박서진 · 최시우 · 서지민',
      note: '최종 제출을 완료한 사용자도 대상에서 제외돼요.',
    });
  });

  it('confirms with the target count and the service notification as the only channel', () => {
    const c = confirmCopy(VIEW);
    expect(c.summary).toBe('9월 미제출 안내 · 7명');
    expect(c.detail).toContain(NOTICE_CHANNEL);
    expect(JSON.stringify(c)).not.toMatch(/이메일|메일|첨부|유예|마감 일정|개인/);
  });

  it('writes the result', () => {
    const r: NoticeSendResult = {
      sent: 7,
      failed: 0,
      employedExcluded: 3,
      sentAt: '2026-09-21T14:30:00+09:00',
    };
    expect(sentCopy(r)).toEqual({
      title: '7명에게 안내를 보냈어요',
      rows: [
        ['발송 성공', '7명'],
        ['발송 실패', '0명'],
        ['취업 중 · 제외', '3명'],
      ],
    });
  });
});
