import { Component } from '@angular/core';

/** 지원금 지급 종료·트랜스퍼 교육생: current policy needs no document registration. */
@Component({
  selector: 'app-hello',
  template: `<h1>Hello world</h1>`,
  styles: `
    :host {
      display: block;
      padding: var(--space-5) 0;
      text-align: center;
    }

    h1 {
      margin: 0;
      font-size: var(--font-size-page-title);
      font-weight: var(--font-weight-bold);
    }
  `,
})
export class Hello {}
