import { Component, ViewEncapsulation, input } from '@angular/core';

/**
 * Wrapper that styles a projected `<table>`: a `--color-bg` header row with rounded ends and
 * muted small headings, plain rows. Set the column widths with `<colgroup>` in the table
 * (the layout is fixed). `dense` makes the body text small and the rows tighter (A00's task table), `loose` makes
 * the rows roomier (A18's record). Not
 * encapsulated, because the table is the page's own markup.
 */
@Component({
  selector: 'app-data-table',
  template: `<ng-content />`,
  encapsulation: ViewEncapsulation.None,
  host: { '[class.dense]': 'dense()', '[class.loose]': 'loose()' },
  styles: `
    app-data-table {
      display: block;
      overflow-x: auto;
    }

    app-data-table table {
      width: 100%;
      min-width: 32rem;
      table-layout: fixed;
      border-collapse: separate;
      border-spacing: 0;
      font-size: var(--font-size-body);
      text-align: left;
    }

    app-data-table.dense table {
      font-size: var(--font-size-caption);
    }

    app-data-table th {
      padding: calc(var(--space-1) * 1.25) var(--space-1);
      background: var(--color-bg);
      font-size: var(--font-size-caption);
      font-weight: var(--font-weight-regular);
      color: var(--color-muted);
    }

    app-data-table th:first-child {
      border-radius: var(--radius-sm) 0 0 var(--radius-sm);
      padding-left: var(--space-2);
    }

    app-data-table th:last-child {
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    }

    app-data-table td {
      padding: calc(var(--space-1) * 1.5) var(--space-1);
      vertical-align: middle;
    }

    app-data-table.dense td {
      padding: calc(var(--space-1) * 1.25) var(--space-1);
    }

    app-data-table.loose td {
      padding: var(--space-2) var(--space-1);
    }

    app-data-table td:first-child {
      padding-left: var(--space-2);
    }
  `,
})
export class DataTable {
  readonly dense = input(false);
  /** Roomier rows for cells with two lines (A18's record) */
  readonly loose = input(false);
}
