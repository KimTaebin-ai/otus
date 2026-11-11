import { Component, input } from '@angular/core';

/**
 * White bordered card. `heading` is the card title (not `title`, which would also
 * become the host's tooltip); an element with the `cardAction` attribute goes to the right
 * of it (count pill, "설정 →"). `footnote` is the muted line at the bottom.
 * `tone="mint"`: mint background without a border.
 */
@Component({
  selector: 'app-card',
  template: `
    @if (heading(); as text) {
      <header>
        <h2>{{ text }}</h2>
        <ng-content select="[cardAction]" />
      </header>
    }
    <ng-content />
    @if (footnote(); as text) {
      <p class="footnote">{{ text }}</p>
    }
  `,
  styleUrl: './card.css',
  host: { '[class.mint]': "tone() === 'mint'" },
})
export class Card {
  readonly heading = input<string>();
  readonly footnote = input<string>();
  readonly tone = input<'default' | 'mint'>('default');
}
