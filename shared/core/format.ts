// Display formats for the server's KST values ("2026-10-05T09:41:00+09:00", "2026-09").
// Plain string slicing: the server already sends KST, so the frontend never does date math.
// Times can be null (a month with no submission period yet): they render as "—".

/** "2026-10-05T09:41:00+09:00" → "10월 5일" */
export function monthDay(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
}

/** "2026-10-05T09:41:00+09:00" → "09:41" */
export function hourMinute(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return iso.slice(11, 16);
}

/** "2026-10-05T09:41:00+09:00" → "10.05" */
export function dotMonthDay(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return `${iso.slice(5, 7)}.${iso.slice(8, 10)}`;
}

/** "2026-10-05T09:41:00+09:00" → "2026.10.05" */
export function dotDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return `${iso.slice(0, 4)}.${dotMonthDay(iso)}`;
}

/** "2026-10-05T09:41:00+09:00" → "2026.10.05 09:41" */
export function dotDateTime(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return `${iso.slice(0, 4)}.${dotMonthDay(iso)} ${hourMinute(iso)}`;
}

/** "…T00:00…" → "오전 12시", "…T23:59…" → "밤 11시 59분" (final U03 FAQ wording) */
export function spokenTime(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const hour = Number(iso.slice(11, 13));
  const minute = Number(iso.slice(14, 16));
  const period = hour < 12 ? '오전' : hour < 18 ? '오후' : '밤';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${h}시${minute ? ` ${minute}분` : ''}`;
}

/**
 * Display-only: the server's `closes_at` is exclusive (next month's 1st 00:00 KST), so the
 * deadline shown is one second earlier. "2026-11-01T00:00:00+09:00" → "2026-10-31T23:59:59+09:00"
 */
export function lastMoment(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const kst = new Date(Date.parse(iso) - 1000 + 9 * 3600 * 1000).toISOString();
  return `${kst.slice(0, 19)}+09:00`;
}

/** "2026-09" → "9" */
export function monthNumber(month: string): string {
  return String(Number(month.split('-')[1]));
}

/**
 * Seconds as hours and minutes, cut down, never rounded up (policy: 초 단위, 반올림 없음).
 * 143999 → "39시간 59분", 144000 → "40시간", 0 → "0시간"
 */
export function hoursText(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}

/** 500000 → "50만 원", 1000000 → "100만 원", 12345 → "12,345원" */
export function wonText(amount: number): string {
  return amount % 10000 === 0
    ? `${(amount / 10000).toLocaleString('ko-KR')}만 원`
    : `${amount.toLocaleString('ko-KR')}원`;
}

/** The object particle that fits the word's last syllable: "고용보험가입내역서" → "를", "통장사본" → "을". */
export function objectParticle(word: string): '을' | '를' {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? '을' : '를';
}
