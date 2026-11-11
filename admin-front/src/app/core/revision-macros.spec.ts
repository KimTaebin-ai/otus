import { COMMON_MACROS, DOC_MACROS, hasMacro, insertMacro, macrosFor } from './revision-macros';
import { REASON_MAX } from './review-copy';

describe('보완 사유 macros', () => {
  const [first, second] = COMMON_MACROS;

  it('fills an empty reason with the sentence as written', () => {
    expect(insertMacro('', first)).toBe(first.text);
    expect(insertMacro('  \n', first)).toBe(first.text);
  });

  it('puts a sentence on a new line after what is already written, never over it', () => {
    expect(insertMacro('직접 쓴 내용', first)).toBe(`직접 쓴 내용\n${first.text}`);
    const both = insertMacro(first.text, second)!;
    expect(both).toBe(`${first.text}\n${second.text}`);
  });

  it('does not add the same sentence twice, nor one that would not fit', () => {
    expect(hasMacro(first.text, first)).toBe(true);
    expect(insertMacro(first.text, first)).toBeNull();
    expect(insertMacro('가'.repeat(REASON_MAX - 5), first)).toBeNull();
  });

  it('offers the chosen documents first, then the common ones; every sentence fits the limit', () => {
    const list = macrosFor(['bankbook']);
    expect(list.slice(0, DOC_MACROS.bankbook.length)).toEqual(DOC_MACROS.bankbook);
    expect(list.slice(-COMMON_MACROS.length)).toEqual([...COMMON_MACROS]);
    for (const macro of Object.values(DOC_MACROS)
      .flat()
      .concat([...COMMON_MACROS])) {
      expect([...macro.text].length).toBeLessThan(REASON_MAX);
    }
  });
});
