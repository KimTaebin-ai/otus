import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import { Button } from '@otus/shared/ui/button';
import { ArchiveState } from '../core/archive-state';
import { loadArchivePreview } from './archive-preview';
import { ArchiveViewComponent } from './archive-view';

@Component({
  selector: 'app-archive',
  imports: [ArchiveViewComponent, Button],
  template: `
    @if (state.loading() && !state.view()) {
      <h1>월 자료함</h1>
      <p role="status">제출 자료를 불러오고 있어요.</p>
    } @else if (state.listError(); as error) {
      <h1>월 자료함</h1>
      <p role="alert">{{ error }}</p>
      <button appButton type="button" (click)="state.load(month(), true)">다시 불러오기</button>
    } @else if (state.view(); as v) {
      @if (state.loading()) {
        <p role="status">조건에 맞는 자료를 불러오고 있어요.</p>
      }
      @if (state.preview()) {
        <p role="note">개발용 미리보기입니다. 실제 파일은 내려받지 않습니다.</p>
      }
      <app-archive-view
        [view]="v"
        [selected]="state.selected()"
        [query]="state.query()"
        [filter]="state.filter()"
        [criteria]="state.criteria()"
        [canDownload]="state.canDownload()"
        [busy]="state.loading() || (state.busy() && !state.preview())"
        (toggle)="state.toggle($event)"
        (toggleShown)="state.setMany($event.userIds, $event.on)"
        (queryChange)="state.query.set($event)"
        (filterChange)="state.filter.set($event)"
        (criteriaChange)="state.setCriteria($event)"
        (resetFilters)="state.resetFilters()"
        (download)="download()"
        (options)="go('options')"
      />
    }
  `,
})
export class Archive {
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
          this.state.load(month, true);
        }
      });
  }

  protected download(): void {
    if (this.state.startExport()) this.go('download');
  }

  protected go(step: 'options' | 'download'): void {
    const view = this.state.view();
    if (view)
      void this.router.navigate(['/archive', view.month, step], {
        queryParamsHandling: 'preserve',
      });
  }
}
