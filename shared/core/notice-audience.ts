import { monthNumber } from './format';

export type NoticeAudience = 'unsubmitted' | 'under_40' | 'hours_40_80' | 'at_least_80';
export const NOTICE_AUDIENCES: { value: NoticeAudience; label: string }[] = [
  { value: 'unsubmitted', label: '미제출' },
  { value: 'under_40', label: '40시간 미만' },
  { value: 'hours_40_80', label: '40시간 이상 80시간 미만' },
  { value: 'at_least_80', label: '80시간 이상' },
];

export function audienceLabel(audience: NoticeAudience): string {
  return NOTICE_AUDIENCES.find((item) => item.value === audience)!.label;
}

export function studyHoursNotice(month: string, hours: 0 | 40 | 80) {
  const label = audienceLabel(
    hours === 80 ? 'at_least_80' : hours === 40 ? 'hours_40_80' : 'under_40',
  );
  return {
    title: `${monthNumber(month)}월 지원금 시간 요건 안내`,
    lines: [
      `${monthNumber(month)}월 학습 시간은 ${label} 구간이에요.`,
      '하루 최대 12시간을 반영한 최근 집계 기준이에요.',
      '최종 지원금 지급 여부는 서류 검토와 별도로 확인해주세요.',
    ],
  };
}
