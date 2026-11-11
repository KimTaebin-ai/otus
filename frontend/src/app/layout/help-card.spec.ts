import { TestBed } from '@angular/core/testing';

import { HelpCard } from './help-card';

describe('HelpCard', () => {
  function render(href: string | null): HTMLElement {
    const fixture = TestBed.createComponent(HelpCard);
    fixture.componentRef.setInput('href', href);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('asks if help is needed and has no link while there is no help page', () => {
    const el = render(null);
    expect(el.textContent).toContain('도움이 필요하신가요?');
    expect(el.textContent).toContain('준비부터 제출까지');
    expect(el.querySelector('a')).toBeNull();
  });

  it('links to the help page once there is one', () => {
    const el = render('https://example.com/help');
    const a = el.querySelector('a');
    expect(a?.textContent).toContain('도움말 보기');
    expect(a?.getAttribute('href')).toBe('https://example.com/help');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });
});
