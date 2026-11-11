import { intraProfileUrl } from './intra';

describe('intraProfileUrl', () => {
  it('points at the 42 profile of the login', () => {
    expect(intraProfileUrl('dongmin')).toBe('https://profile.intra.42.fr/users/dongmin');
    expect(intraProfileUrl('dong-kim_2')).toBe('https://profile.intra.42.fr/users/dong-kim_2');
  });

  it('gives no link for anything that is not a plain login', () => {
    for (const bad of ['', 'a/b', '../x', 'a b', 'a?b', '<script>']) {
      expect(intraProfileUrl(bad)).toBeNull();
    }
  });
});
