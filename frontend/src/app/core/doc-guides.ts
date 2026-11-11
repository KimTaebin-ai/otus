import { DocType } from './api.models';

/** Where a document comes from and how to turn it into the PDF the upload needs */
export interface DocGuide {
  /** One short line: where to get it */
  where: string;
  /** What to do there */
  how: string;
  /** The official site, when there is one single place to go (opens in a new tab) */
  link?: { label: string; url: string };
}

/**
 * 서류 발급처 안내. Campus wording and links live here, not in the pages, so the operations team
 * can correct them without touching a component. Check the sites' menus now and then: they change.
 */
export const DOC_GUIDES: Record<DocType, DocGuide> = {
  id_card: {
    where: '내 신분증',
    how: '주민등록증이나 운전면허증처럼 사진이 있는 신분증을 스캔하거나 사진으로 찍어 PDF로 저장해요. 글자가 선명하게 보여야 해요.',
  },
  resident_abstract: {
    where: '정부24',
    how: '정부24에 로그인해서 ‘주민등록표 초본’을 발급받은 뒤 PDF로 저장해요. 본인 명의로 발급한 서류만 인정돼요.',
    link: { label: '정부24 바로가기', url: 'https://www.gov.kr' },
  },
  bankbook: {
    where: '사용 중인 은행 앱·인터넷뱅킹',
    how: '지원금을 받을 본인 명의 계좌의 통장 사본(계좌 사본)을 은행 앱에서 내려받아 PDF로 저장해요. 은행 앱의 계좌 상세나 증명서 메뉴에서 찾을 수 있어요.',
  },
  employment_insurance: {
    where: '고용보험 홈페이지',
    how: '고용보험 홈페이지에서 본인 인증 후 고용보험 가입내역서를 발급받아 PDF로 저장해요. 제출하는 달 1일 이후에 발급한 서류만 인정돼요.',
    link: { label: '고용보험 홈페이지 바로가기', url: 'https://www.ei.go.kr' },
  },
};
