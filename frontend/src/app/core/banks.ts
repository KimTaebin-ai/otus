/**
 * Banks for the 계좌 변경 dropdown. The server sends no list (api.md: `bank` is free text of
 * 1–30 characters), so this constant is the choice shown; a bank already on the account is added
 * by the form when it isn't here.
 */
export const BANKS = [
  '국민은행',
  '신한은행',
  '우리은행',
  '하나은행',
  '농협은행',
  '기업은행',
  'SC제일은행',
  '수협은행',
  '카카오뱅크',
  '케이뱅크',
  '토스뱅크',
  '우체국',
  '새마을금고',
  '신협',
  '부산은행',
  'iM뱅크',
  '경남은행',
  '광주은행',
  '전북은행',
  '제주은행',
] as const;
