import { Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';

/**
 * Modal: a dimmed backdrop (`--overlay`) and a white panel with the projected content.
 * `label` names it for screen readers. Escape (and a click on the backdrop, unless
 * `dismissible` is false) emits `dismissed`. The panel takes focus when it opens.
 */
@Component({
  selector: 'app-dialog',
  template: `
    <div class="backdrop" (click)="backdropClick()">
      <div
        class="panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        [attr.aria-label]="label()"
        (click)="$event.stopPropagation()"
        (keydown.escape)="dismiss()"
      >
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-3);
      background: var(--overlay);
    }

    .panel {
      width: min(100%, var(--width-dialog));
      max-height: 100%;
      overflow-y: auto;
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }

    @media (max-width: 600px) {
      .backdrop {
        padding: var(--space-1);
      }

      .panel {
        padding: var(--space-3) var(--space-2);
      }
    }

    .panel:focus {
      outline: none;
    }
  `,
})
export class Dialog {
  readonly label = input.required<string>();
  readonly dismissible = input(true);
  readonly dismissed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.panel')?.focus());
  }

  protected backdropClick(): void {
    if (this.dismissible()) {
      this.dismiss();
    }
  }

  protected dismiss(): void {
    if (this.dismissible()) {
      this.dismissed.emit();
    }
  }
}
