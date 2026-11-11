import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import { Button } from '@otus/shared/ui/button';
import { ArchiveState } from '../core/archive-state';
import { loadArchivePreview } from './archive-preview';
import { ArchiveOptionsViewComponent } from './archive-options-view';

@Component({
  selector: 'app-archive-options',
  imports: [ArchiveOptionsViewComponent, Button],
  template: `
    @if (state.loading()) {
      <h1>내려받기 옵션</h1>
      <p role="status">제출 자료를 불러오고 있어요.</p>
    } @else if (state.listError(); as error) {
      <h1>내려받기 옵션</h1>
      <p role="alert">{{ error }}</p>
      <button appButton type="button" (click)="state.load(month(), true)">다시 불러오기</button>
    } @else if (state.view(); as v) {
      @if (state.preview()) {
        <p role="note">개발용 미리보기입니다. 실제 파일은 내려받지 않습니다.</p>
      }
      <app-archive-options-view
        [month]="v.month"
        [rows]="state.selectedRows()"
        [options]="state.options()"
        [criteria]="state.criteria()"
        [canDownload]="state.canDownload()"
        [busy]="state.busy() && !state.preview()"
        (optionChange)="state.setOption($event.key, $event.on)"
        (download)="download()"
        (back)="go()"
      />
    }
  `,
})
export class ArchiveOptionsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly state = inject(ArchiveState);
  protected readonly month = signal('');

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => params.get('month') ?? ''),
        distinctUntilChanged(),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((month) => {
        this.month.set(month);
        if (
          (typeof ngDevMode === 'undefined' || ngDevMode) &&
          this.route.snapshot.queryParamMap.has('preview')
        ) {
          this.state.usePreview();
          loadArchivePreview(this.route, this.state);
        } else {
          this.state.load(month);
        }
      });
  }

  protected download(): void {
    if (this.state.startExport()) this.go('download');
  }

  protected go(step?: 'download'): void {
    const month = this.state.view()?.month ?? this.month();
    void this.router.navigate(step ? ['/archive', month, step] : ['/archive', month], {
      queryParamsHandling: 'preserve',
    });
  }
}
