import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import { Button } from '@otus/shared/ui/button';
import { ArchiveState } from '../core/archive-state';
import { ArchiveDownloadViewComponent } from './archive-download-view';
import { loadArchivePreview } from './archive-preview';

/** Visiting this route reads metadata only. Creating a ZIP requires a button click. */
@Component({
  selector: 'app-archive-download',
  imports: [ArchiveDownloadViewComponent, Button],
  template: `
    @if (state.loading()) {
      <h1>다운로드</h1>
      <p role="status">제출 자료를 불러오고 있어요.</p>
    } @else if (state.listError(); as error) {
      <h1>다운로드</h1>
      <p role="alert">{{ error }}</p>
      <button appButton type="button" (click)="state.load(month(), true)">다시 불러오기</button>
    } @else if (state.view(); as v) {
      <app-archive-download-view
        [month]="v.month"
        [rows]="state.downloadRows()"
        [options]="state.downloadOptions()"
        [criteria]="state.downloadCriteria()"
        [status]="state.status()"
        [canDownload]="state.canDownload()"
        [receiving]="state.receiving()"
        [retryAfter]="state.retryAfter()"
        [downloadStarted]="state.downloadStarted()"
        [error]="state.error()"
        [expired]="state.expired()"
        [preview]="state.preview()"
        [job]="state.job()"
        (retry)="state.retry()"
        (cancelWait)="state.cancelWait()"
        (archive)="go()"
        (editOptions)="go('options')"
      />
    }
  `,
})
export class ArchiveDownload {
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

  protected go(step?: 'options'): void {
    const month = this.state.view()?.month ?? this.month();
    void this.router.navigate(step ? ['/archive', month, step] : ['/archive', month], {
      queryParamsHandling: 'preserve',
    });
  }
}
