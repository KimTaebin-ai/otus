import { ActivatedRoute } from '@angular/router';

import { ArchiveState } from '../core/archive-state';

/**
 * Dev builds only: `?preview` on any 자료함 screen fills the state with `dev/preview-data.ts`;
 * `?preview=creating` and `=failed` set the state of A14's download. The guard sits here, so a
 * production build drops the import and the values with it.
 */
export function loadArchivePreview(route: ActivatedRoute, state: ArchiveState): void {
  if (typeof ngDevMode === 'undefined' || ngDevMode) {
    const preview = route.snapshot.queryParamMap.get('preview');
    if (preview === null) {
      return;
    }
    if (preview === 'creating' || preview === 'failed') {
      state.status.set(preview);
    }
    if (!state.view()) {
      void import('../dev/preview-data').then((m) => {
        if (state.preview()) state.show(m.ARCHIVE_PREVIEW);
      });
    }
  }
}
