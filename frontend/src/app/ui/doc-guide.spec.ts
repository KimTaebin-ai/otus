import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { DocType } from '../core/api.models';
import { DOC_GUIDES } from '../core/doc-guides';
import { DocGuideBox } from './doc-guide';

@Component({
  imports: [DocGuideBox],
  template: `<app-doc-guide
    [docTypes]="types"
    [compact]="compact"
    [collapsible]="collapsible"
    [startOpen]="startOpen"
  />`,
})
class Host {
  types: DocType[] = ['id_card', 'resident_abstract', 'bankbook', 'employment_insurance'];
  compact = false;
  collapsible = false;
  startOpen = true;
}

function render(types: DocType[], compact = false, fold?: { startOpen: boolean }) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.types = types;
  fixture.componentInstance.compact = compact;
  if (fold) {
    fixture.componentInstance.collapsible = true;
    fixture.componentInstance.startOpen = fold.startOpen;
  }
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, fixture };
}

describe('DocGuideBox', () => {
  it('names every document with where to get it, and links the official sites', () => {
    const { el } = render(['id_card', 'resident_abstract', 'bankbook', 'employment_insurance']);
    expect(el.querySelector('h3')?.textContent).toContain('서류는 어디서 받나요?');
    expect(el.querySelectorAll('li')).toHaveLength(4);
    for (const name of ['신분증', '주민등록초본', '통장사본', '고용보험가입내역서']) {
      expect(el.textContent).toContain(name);
    }
    const links = [...el.querySelectorAll('a')];
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\//);
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
    expect(links[0].getAttribute('href')).toBe(DOC_GUIDES.resident_abstract.link?.url);
  });

  it('a single document in compact form has no heading or document name', () => {
    const { el } = render(['employment_insurance'], true);
    expect(el.querySelector('h3')).toBeNull();
    expect(el.querySelector('.name')).toBeNull();
    expect(el.textContent).toContain('고용보험 홈페이지');
    expect(el.querySelectorAll('a')).toHaveLength(1);
  });

  it('can be folded away: the list hides, one line of names stays, and it unfolds again', () => {
    const { el, fixture } = render(['id_card', 'bankbook'], false, { startOpen: false });
    const toggle = el.querySelector<HTMLButtonElement>('.toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelectorAll('li')).toHaveLength(0);
    expect(el.querySelector('.summary')?.textContent).toContain('신분증 · 통장사본');

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelectorAll('li')).toHaveLength(2);
    expect(el.querySelector('.summary')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('li')).toHaveLength(0);
  });

  it('is always open when it cannot be folded', () => {
    const { el } = render(['id_card']);
    expect(el.querySelector('.toggle')).toBeNull();
    expect(el.querySelectorAll('li')).toHaveLength(1);
  });
});
