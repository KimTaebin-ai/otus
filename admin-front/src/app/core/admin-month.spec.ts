import { TestBed } from '@angular/core/testing';

import { AdminMonth } from './admin-month';

describe('AdminMonth window stepping', () => {
  const months = () => {
    const m = TestBed.inject(AdminMonth);
    m.working.set('2026-11');
    return m;
  };

  it('starts on the window of today', () => {
    const m = months();
    expect(m.viewing()).toBe('2026-11');
    expect(m.canGoNext()).toBe(false);
  });

  it('goes back to earlier windows and forward again, but never past today', () => {
    const m = months();
    m.step(-1);
    expect(m.viewing()).toBe('2026-10');
    expect(m.canGoNext()).toBe(true);
    m.step(-1);
    expect(m.viewing()).toBe('2026-09');
    m.step(1);
    m.step(1);
    expect(m.viewing()).toBe('2026-11');
    m.step(1);
    expect(m.viewing()).toBe('2026-11');
    expect(m.canGoNext()).toBe(false);
  });
});
