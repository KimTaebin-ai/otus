import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Card } from '@otus/shared/ui/card';

/**
 * Home "내 정보" card (final U03-home-due-profile.png, U03-home-submitted.png): "설정 →" to
 * /settings, 취업 상태, 받을 계좌 and the note. The texts come from the page.
 */
@Component({
  selector: 'app-profile-card',
  imports: [Card, RouterLink],
  template: `
    <app-card heading="내 정보">
      <a cardAction class="link" routerLink="/settings">설정 →</a>
      <dl class="facts">
        <div>
          <dt>취업 상태</dt>
          <dd>{{ employment() }}</dd>
        </div>
        <div>
          <dt>받을 계좌</dt>
          <dd>{{ account() }}</dd>
        </div>
      </dl>
      <hr />
      <p class="note">받을 계좌나 취업 상태가 바뀌면<br />이곳에서 알려주세요.</p>
    </app-card>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }

    /* the whole card is the "설정 →" link (stretched link: keeps one real, focusable anchor) */
    .link::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: var(--radius-lg);
    }

    app-card {
      transition:
        border-color 0.2s ease,
        box-shadow 0.2s ease;
    }

    :host(:hover) app-card,
    :host(:focus-within) app-card {
      border-color: var(--color-teal);
      box-shadow: 0 2px 8px color-mix(in srgb, var(--color-teal) 15%, transparent);
    }

    .link {
      font-size: var(--font-size-label);
      font-weight: var(--font-weight-medium);
      color: var(--color-teal);
      text-decoration: none;
    }

    .facts {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: var(--space-1) 0 0;
    }

    .facts div {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--space-1);
    }

    .facts dt {
      color: var(--color-muted);
    }

    .facts dd {
      margin: 0;
      font-weight: var(--font-weight-medium);
    }

    hr {
      width: 100%;
      margin: 0;
      border: 0;
      border-top: var(--border-width) solid var(--color-border);
    }

    .note {
      margin: 0;
      color: var(--color-muted);
      line-height: 1.7;
    }
  `,
})
export class ProfileCard {
  /** "취업 중" / "미취업" */
  readonly employment = input.required<string>();
  /** "카카오뱅크 · •••• 1234", or "—" */
  readonly account = input.required<string>();
}
