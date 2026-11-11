import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs';

export interface PlaceholderData {
  code: string;
  title: string;
  todo: string[];
}

/** Stand-in for screens that aren't built yet; replace per route in app.routes.ts. */
@Component({
  selector: 'app-placeholder',
  template: `
    @if (page(); as p) {
      <h1>{{ p.code }} {{ p.title }}</h1>
      <p>아직 만들지 않은 화면입니다.</p>
      <ul>
        @for (item of p.todo; track item) {
          <li>{{ item }}</li>
        }
      </ul>
    }
  `,
})
export class Placeholder {
  protected readonly page = toSignal(inject(ActivatedRoute).data as Observable<PlaceholderData>);
}
