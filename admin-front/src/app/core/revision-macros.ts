import { DocType } from '@otus/shared/core/api-types';
import { REASON_MAX } from './review-copy';

/** A finished sentence a reviewer can drop into the 보완 사유 with one click */
export interface ReasonMacro {
  /** Short name on the button */
  label: string;
  /** The sentence the student reads, as written */
  text: string;
}

/**
 * Ready-made 보완 사유. The wording is campus policy, not code, so it lives here: the operations
 * team can add or reword a sentence without touching a screen. Each one says what is wrong and
 * what to do, because the student reads it as it is.
 */
export const COMMON_MACROS: readonly ReasonMacro[] = [
  {
    label: '흐리거나 잘 안 보임',
    text: '파일이 흐려서 글자를 읽을 수 없어요. 선명하게 다시 스캔하거나 촬영해서 올려주세요.',
  },
  {
    label: '일부 잘림',
    text: '서류의 일부가 잘려 있어요. 모든 페이지가 빠짐없이 보이도록 다시 올려주세요.',
  },
  {
    label: '본인 명의 아님',
    text: '본인 명의의 서류가 아니에요. 본인 이름으로 발급된 서류를 올려주세요.',
  },
  {
    label: '다른 서류가 올라옴',
    text: '요청한 서류와 다른 파일이 올라왔어요. 해당 서류가 맞는지 확인하고 다시 올려주세요.',
  },
  {
    label: '파일이 열리지 않음',
    text: 'PDF 파일이 열리지 않아요. 암호가 걸려 있다면 풀고, 파일이 손상되지 않았는지 확인한 뒤 다시 올려주세요.',
  },
];

export const DOC_MACROS: Readonly<Record<DocType, readonly ReasonMacro[]>> = {
  id_card: [
    {
      label: '신분증 사진·이름 확인 불가',
      text: '신분증의 사진과 이름이 잘 보이지 않아요. 앞면 전체가 보이도록 다시 올려주세요.',
    },
  ],
  resident_abstract: [
    {
      label: '초본 다시 발급',
      text: '주민등록초본을 확인할 수 없어요. 정부24에서 본인 명의로 다시 발급받아 올려주세요.',
    },
  ],
  bankbook: [
    {
      label: '계좌번호·예금주 안 보임',
      text: '통장사본에서 계좌번호와 예금주가 모두 보이지 않아요. 두 가지가 보이는 통장사본을 올려주세요.',
    },
    {
      label: '입력한 계좌와 다름',
      text: '입력하신 계좌번호와 통장사본의 계좌번호가 달라요. 확인한 뒤 다시 제출해주세요.',
    },
  ],
  employment_insurance: [
    {
      label: '발급일이 1일 이전',
      text: '발급일이 제출하는 달 1일 이전이에요. 해당 월 1일 이후에 발급한 고용보험가입내역서를 올려주세요.',
    },
    {
      label: '고용보험 가입 확인',
      text: '고용보험 가입 내역이 확인돼요. 현재 근로 중이시라면 서류를 제출하지 말고 ‘취업 중’으로 상태를 변경해주세요.',
    },
  ],
};

/** The macros to offer: those of the chosen documents first, then the common ones */
export function macrosFor(docTypes: readonly DocType[]): ReasonMacro[] {
  return [...docTypes.flatMap((type) => DOC_MACROS[type]), ...COMMON_MACROS];
}

/** Whether the reason already holds this sentence */
export function hasMacro(reason: string, macro: ReasonMacro): boolean {
  return reason.includes(macro.text);
}

/**
 * The reason after a click: an empty field gets the sentence, otherwise it goes on a new line
 * after what is written (nothing is overwritten). null when it is already there or would not fit.
 */
export function insertMacro(reason: string, macro: ReasonMacro): string | null {
  if (hasMacro(reason, macro)) return null;
  const current = reason.trimEnd();
  const next = current ? `${current}\n${macro.text}` : macro.text;
  return [...next].length > REASON_MAX ? null : next;
}
