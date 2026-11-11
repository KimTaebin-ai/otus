import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { monthNumber } from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { DashboardView } from '../core/admin.models';
import {
  dashboardCards,
  employedHeading,
  hoursLine,
  previousLines,
  taskRows,
} from '../core/dashboard-copy';
import { DataTable } from '../ui/data-table';
import { PageHeader } from '../ui/page-header';
import { StatCard } from '../ui/stat-card';

/**
 * A00 현황 대시보드 (final A00-dashboard.png, old style: content and layout only). Pure
 * display: everything comes from `view`. No 유예 or 개명 rows or buttons (v1.0).
 */
@Component({
  selector: 'app-dashboard-view',
  imports: [Button, Card, DataTable, PageHeader, RouterLink, StatCard],
  templateUrl: './dashboard-view.html',
  styleUrl: './dashboard-view.css',
})
export class DashboardViewComponent {
  readonly view = input.required<DashboardView>();

  protected readonly title = computed(() => `${monthNumber(this.view().month)}월 지원금 운영 현황`);
  protected readonly cards = computed(() => dashboardCards(this.view()));
  protected readonly heading = computed(() => employedHeading(this.view()));
  protected readonly hours = computed(() => hoursLine(this.view()));
  protected readonly previous = computed(() => previousLines(this.view()));
  protected readonly tasks = computed(() => taskRows(this.view()));
}
