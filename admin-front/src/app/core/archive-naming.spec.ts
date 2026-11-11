import {
  baseFileName,
  currentFileName,
  previousFileName,
  rootFolder,
  safeName,
  studentFolder,
  uniqueNames,
  zipName,
} from './archive-naming';

describe('safeName', () => {
  it('keeps a normal Korean or ASCII name', () => {
    expect(safeName('동민')).toBe('동민');
    expect(safeName('dongkim2')).toBe('dongkim2');
  });

  it('replaces the characters a file system cannot hold', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(safeName('x\u0000y\u001fz')).toBe('x_y_z');
  });

  it('replaces invisible format characters such as the bidi override', () => {
    expect(safeName('abc‮fdp.exe')).toBe('abc_fdp.exe');
    expect(safeName('a​b')).toBe('a_b');
  });

  it('drops trailing dots and spaces, collapses spaces, trims', () => {
    expect(safeName('  김  하린 ')).toBe('김 하린');
    expect(safeName('name...')).toBe('name');
    expect(safeName('name. . ')).toBe('name');
  });

  it('never returns an empty name, "." or ".."', () => {
    expect(safeName('')).toBe('_');
    expect(safeName('   ')).toBe('_');
    expect(safeName('.')).toBe('_');
    expect(safeName('..')).toBe('_');
  });

  it('prefixes Windows device names, with or without an extension', () => {
    expect(safeName('con')).toBe('_con');
    expect(safeName('NUL')).toBe('_NUL');
    expect(safeName('lpt1.txt')).toBe('_lpt1.txt');
    expect(safeName('console')).toBe('console');
  });

  it('cuts long names by characters, not by bytes', () => {
    expect(safeName('가'.repeat(100))).toBe('가'.repeat(40));
    expect(safeName('a'.repeat(100), 10)).toBe('a'.repeat(10));
  });

  it('writes a decomposed Korean name in NFC', () => {
    expect(safeName('한')).toBe('한');
  });
});

describe('uniqueNames', () => {
  it('leaves different names alone', () => {
    expect(uniqueNames(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('numbers the second and later of the same name', () => {
    expect(uniqueNames(['a', 'a', 'a'])).toEqual(['a', 'a_2', 'a_3']);
  });

  it('puts the number before the extension for files', () => {
    expect(uniqueNames(['9월_고용보험.pdf', '9월_고용보험.pdf'], true)).toEqual([
      '9월_고용보험.pdf',
      '9월_고용보험_2.pdf',
    ]);
  });

  it('treats names that differ only in case as the same', () => {
    expect(uniqueNames(['Kim_A', 'kim_a'])).toEqual(['Kim_A', 'kim_a_2']);
  });

  it('treats NFC and NFD spellings as the same', () => {
    expect(uniqueNames(['한', '한'])).toEqual(['한', '한_2']);
  });

  it('never returns a name twice, even when a later name equals a generated one', () => {
    const out = uniqueNames(['a', 'a', 'a_2']);
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(3);
    expect(out).toEqual(['a', 'a_2', 'a_2_2']);
  });
});

describe('archive names', () => {
  it('names the root folder and the ZIP', () => {
    expect(rootFolder('2026-09')).toBe('2026년 9월');
    expect(rootFolder('2026-12')).toBe('2026년 12월');
    expect(zipName('2026-09')).toBe('2026년 9월_지원금 자료.zip');
  });

  it('names a student folder with the name and the login', () => {
    expect(studentFolder('동민', 'dongkim2')).toBe('동민_dongkim2');
    expect(studentFolder('a/b', 'x:y')).toBe('a_b_x_y');
  });

  it('names the files', () => {
    expect(currentFileName('2026-09', 'employment_insurance')).toBe('9월_고용보험.pdf');
    expect(currentFileName('2026-09', 'id_card')).toBe('9월_신분증.pdf');
    expect(baseFileName('bankbook')).toBe('기본서류_통장사본.pdf');
    expect(previousFileName('2026-09', 'employment_insurance')).toBe('이전제출본_9월_고용보험.pdf');
  });
});
