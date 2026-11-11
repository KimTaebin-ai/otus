/** What the API gives about a student's identity (api.md: null until the student entered it) */
export interface StudentProfile {
  ordinal?: string | null;
  ko_name?: string | null;
  /** YYYY-MM-DD */
  date_of_birth?: string | null;
}

/**
 * "9" / "9기" / "3a" → "9기" / "9기" / "3기A". The API takes free text, so anything that is not
 * that shape is shown as typed.
 */
export function ordinalText(raw: string): string {
  const text = raw.trim();
  const m = /^(\d+)\s*기?\s*([A-Za-z]?)$/.exec(text);
  return m ? `${m[1]}기${m[2].toUpperCase()}` : text;
}

/** "2003-04-21" → "030421". Never a resident registration number. */
export function birthText(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[1].slice(2)}${m[2]}${m[3]}` : '';
}

/**
 * "9기A_홍길동(030421)": how a student is named on screens and in downloaded file names. The
 * 한글 이름 replaces `name`; a part the student has not entered yet is left out.
 */
export function studentLabel(name: string, profile?: StudentProfile | null): string {
  const base = profile?.ko_name?.trim() || name;
  const ordinal = profile?.ordinal?.trim();
  const birth = profile?.date_of_birth ? birthText(profile.date_of_birth) : '';
  return `${ordinal ? `${ordinalText(ordinal)}_` : ''}${base}${birth ? `(${birth})` : ''}`;
}
