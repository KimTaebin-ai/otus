/**
 * The 42 Intra profile of a student, where the logged hours can be checked by hand. The 42 login
 * is the Intra id. Anything that is not a plain login (the API only gives those) gets no link.
 */
export function intraProfileUrl(login: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(login)
    ? `https://profile.intra.42.fr/users/${encodeURIComponent(login)}`
    : null;
}
