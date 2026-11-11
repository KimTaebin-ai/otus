import { Component, ElementRef, computed, effect, input, output, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Card } from '@otus/shared/ui/card';
import { Spinner } from '@otus/shared/ui/spinner';
import { UserListRow } from '../core/admin-users';
import {
  USERS_DESCRIPTION,
  USERS_TITLE,
  userRows,
  usersEmpty,
  usersHeading,
} from '../core/users-copy';
import { DataTable } from '../ui/data-table';
import { Field } from '../ui/field';
import { PageHeader } from '../ui/page-header';

/**
 * The /users list (no design image; built from A18's and A12's pieces). Pure display: the rows,
 * the search text and the loading state come in, the search and "load the next page" go out
 * (infinite scroll: `more` fires when the list box itself is scrolled to its bottom). A name opens
 * the user's A18.
 */
@Component({
  selector: 'app-users-view',
  imports: [Card, DataTable, Field, PageHeader, RouterLink, Spinner],
  templateUrl: './users-view.html',
  styleUrl: './users-view.css',
})
export class UsersViewComponent {
  readonly rows = input.required<UserListRow[]>();
  readonly query = input('');
  readonly hasMore = input(false);
  readonly loading = input(false);
  /** A message when the last request failed */
  readonly error = input<string | null>(null);

  readonly queryChange = output<string>();
  readonly more = output<void>();

  protected readonly title = USERS_TITLE;
  protected readonly description = USERS_DESCRIPTION;
  protected readonly shown = computed(() => userRows(this.rows()));
  protected readonly heading = computed(() => usersHeading(this.rows().length, this.hasMore()));
  protected readonly emptyText = computed(() => usersEmpty(this.query()));

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // A list shorter than its box never scrolls: keep asking until it fills or runs out.
    effect(() => {
      const box = this.scroller()?.nativeElement;
      this.rows();
      if (box) {
        setTimeout(() => this.loadIfFilled(box));
      }
    });
  }

  /** Scrolling inside the list box: the next page when its bottom is near */
  protected onScroll(box: HTMLElement): void {
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - NEAR_END_PX) {
      this.requestMore();
    }
  }

  private loadIfFilled(box: HTMLElement): void {
    if (box.scrollHeight <= box.clientHeight) {
      this.requestMore();
    }
  }

  private requestMore(): void {
    if (this.hasMore() && !this.loading() && !this.error()) {
      this.more.emit();
    }
  }
}

/** How close to the bottom of the list box (px) the next page is asked for */
const NEAR_END_PX = 48;
