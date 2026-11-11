import { Component, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'md' | 'sm';

/**
 * Styles a native button: `<button appButton>` (primary) or `variant="secondary"`.
 * `size="sm"` is the shorter secondary button with a "→" in its text.
 * One primary per screen; secondary actions go to its left (docs/design/README.md).
 * Disabled look comes from the native `disabled` attribute.
 */
@Component({
  selector: 'button[appButton]',
  template: `<ng-content />`,
  styleUrl: './button.css',
  host: {
    '[class.secondary]': "variant() === 'secondary'",
    '[class.sm]': "size() === 'sm'",
  },
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
}
