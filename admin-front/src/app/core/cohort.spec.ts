import { birthText, ordinalText, studentLabel } from './cohort';

describe('studentLabel', () => {
  it('writes n기_이름(생년월일6자)', () => {
    expect(
      studentLabel('hanjimin', { ordinal: '9', ko_name: '한지민', date_of_birth: '2003-04-21' }),
    ).toBe('9기_한지민(030421)');
  });

  it('normalizes free-text 기수', () => {
    expect(ordinalText('9')).toBe('9기');
    expect(ordinalText('7기')).toBe('7기');
    expect(ordinalText('3a')).toBe('3기A');
    expect(ordinalText('9기A')).toBe('9기A');
    expect(ordinalText('특별반')).toBe('특별반');
  });

  it('leaves out what the student has not entered', () => {
    expect(studentLabel('동민')).toBe('동민');
    expect(studentLabel('동민', { ordinal: null, ko_name: '김동민', date_of_birth: null })).toBe(
      '김동민',
    );
    expect(studentLabel('동민', { ordinal: '5' })).toBe('5기_동민');
  });

  it('turns a date into six digits', () => {
    expect(birthText('2001-03-14')).toBe('010314');
    expect(birthText('nonsense')).toBe('');
  });
});
