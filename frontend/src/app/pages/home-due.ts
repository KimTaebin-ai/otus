import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { RouterLink } from '@angular/router';

import {
  dotMonthDay,
  hourMinute,
  lastMoment,
  monthDay,
  monthNumber,
} from '@otus/shared/core/format';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { AuthService } from '../core/auth.service';
import { Cycle } from '../core/api.models';
import { ApiService } from '../core/api.service';
import { accountText, employmentText } from '../core/profile';
import { ProfileCard } from './profile-card';
import { HoursHero } from './hours-hero';

/**
 * U03 홈, this month due (final U03-home-due.png). Hidden (out of scope): "제출 대상 안내",
 * "대상 확인 요청".
 */
@Component({
  selector: 'app-home-due',
  imports: [Button, Card, ProfileCard, RouterLink, HoursHero],
  templateUrl: './home-due.html',
  styleUrl: './home-due.css',
})
export class HomeDue {
  readonly cycle = input.required<Cycle>();

  protected readonly me = inject(AuthService).me;
  protected readonly employment = computed(() => employmentText(this.me()));
  /** "카카오뱅크 · •••• 1234", as in final U03-home-due-profile */
  private readonly bank = toSignal(
    inject(ApiService)
      .bankAccount()
      .pipe(catchError(() => of(null))),
    { initialValue: null },
  );
  protected readonly account = computed(() => accountText(this.bank(), ' · '));

  protected readonly monthNumber = monthNumber;
  protected readonly monthDay = monthDay;
  protected readonly hourMinute = hourMinute;
  protected readonly lastMoment = lastMoment;
  protected readonly dotMonthDay = dotMonthDay;
}
