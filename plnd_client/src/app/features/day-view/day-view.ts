import { Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ScheduleService, todayIso } from '../../core/services/schedule.service';
import { BriefingService } from '../../core/services/briefing.service';
import { TimezoneService } from '../../core/services/timezone.service';
import { isMealAnchor, ScheduleItem, TaskEditPatch } from '../../core/models/schedule';
import { TimezoneAnchorDto } from '../../core/models/timezone';
import { classifyDay, DayZoneView } from '../../core/utils/zone-projection';
import { DayHeaderComponent } from '../schedule/components/day-header/day-header';
import { MealRowComponent } from '../schedule/components/meal-row/meal-row';
import { TaskRowComponent } from '../schedule/components/task-row/task-row';
import { AddEntryComponent, AddedEntry } from '../schedule/components/add-entry/add-entry';
import { BriefingHeaderComponent } from './components/briefing-header/briefing-header';
import { YesterdaySnapshotComponent } from './components/yesterday-snapshot/yesterday-snapshot';
import { TimezoneSwitchRowComponent } from './components/timezone-switch-row/timezone-switch-row';
import { TimezoneWhyComponent } from './components/timezone-why/timezone-why';

@Component({
  selector: 'app-day-view',
  standalone: true,
  imports: [
    DayHeaderComponent,
    MealRowComponent,
    TaskRowComponent,
    AddEntryComponent,
    BriefingHeaderComponent,
    YesterdaySnapshotComponent,
    TimezoneSwitchRowComponent,
    TimezoneWhyComponent,
  ],
  template: `
    <div class="schedule-view">

      <app-day-header
        [date]="scheduleService.date()"
        [zoneView]="zoneView()"
        (dateChange)="onDateChange($event)"
        (whyClicked)="openWhyForGoverning()"
      />

      @if (whyOpen(); as a) {
        <app-timezone-why
          [anchor]="a"
          [currentZone]="zoneView()?.currentZone ?? tz.deviceZone()"
          (useCurrent)="onUseCurrent(a)"
          (pickZone)="onPickZone(a, $event)"
          (closed)="whyOpen.set(null)"
        />
      }

      @if (isToday()) {
        <app-briefing-header />
      }

      @if (scheduleService.isLoading()) {
        <div class="skeleton-list" aria-label="Loading schedule" aria-busy="true">
          <div class="skeleton skeleton--meal"></div>
          <div class="skeleton skeleton--task"></div>
          <div class="skeleton skeleton--task"></div>
        </div>
      } @else if (scheduleService.loadError()) {
        <div class="error-state" role="alert">
          <p>Couldn't load your day.
            <button class="retry-link" (click)="retry()">Tap to retry.</button>
          </p>
        </div>
      } @else {
        @if (scheduleService.scheduleItems().length === 0) {
          <div class="empty-state">
            <p>Nothing planned yet. Add something to get started.</p>
          </div>
        } @else {
          <div class="schedule-list">
            @if (zoneView()?.kind === 'travel') {
              <!-- v1: switch row at top of list; finer per-item ordering is a follow-up -->
              <app-timezone-switch-row
                [switch]="zoneView()!.switch!"
                [date]="scheduleService.date()"
                (whyClicked)="openWhy(zoneView()!.switch!.anchor)"
              />
            }
            @for (item of scheduleService.scheduleItems(); track item.id) {
              @if (isMealAnchor(item)) {
                <app-meal-row
                  [id]="'task-row-' + item.id"
                  [class.dimmed]="isSpotlightDimmed(item)"
                  [attr.inert]="isSpotlightDimmed(item) ? '' : null"
                  [meal]="item"
                  [date]="scheduleService.date()"
                  [editingId]="editingId()"
                  (editRequested)="openEditor($event)"
                  (save)="onEditSave(editingId()!, $event)"
                  (closed)="closeEditor()"
                  (toggled)="scheduleService.toggleItem($event)"
                  (doneToggle)="scheduleService.toggleMealConsumed($event)"
                  (skipped)="scheduleService.setMealConsumption($event, 'skipped')"
                />
              } @else {
                <app-task-row
                  [id]="'task-row-' + item.id"
                  [class.dimmed]="isSpotlightDimmed(item)"
                  [attr.inert]="isSpotlightDimmed(item) ? '' : null"
                  [item]="item"
                  [editing]="editingId() === item.id"
                  (editRequested)="openEditor($event)"
                  (save)="onEditSave(item.id, $event)"
                  (closed)="closeEditor()"
                  (toggled)="scheduleService.toggleItem($event)"
                />
              }
            }
          </div>
        }
      }
      <app-add-entry
        [date]="scheduleService.date()"
        (added)="onItemAdded($event)"
        (confirmed)="onTaskConfirmed($event)"
      />

      @if (isToday()) {
        <app-yesterday-snapshot />
      }

      @if (toastMessage()) {
        <div class="toast" role="status" aria-live="polite">
          <span class="toast-message">{{ toastMessage() }}</span>
          <button class="toast-close" type="button" (click)="closeToast()" aria-label="Dismiss">×</button>
        </div>
      }

    </div>
  `,
  styleUrl: './day-view.scss',
})
export class DayViewComponent implements OnInit, OnDestroy {
  protected readonly scheduleService = inject(ScheduleService);
  protected readonly briefingService = inject(BriefingService);
  readonly tz                        = inject(TimezoneService);
  protected readonly isMealAnchor    = isMealAnchor;
  private  readonly route            = inject(ActivatedRoute);
  private  readonly router           = inject(Router);
  private  readonly destroyRef       = inject(DestroyRef);

  readonly isToday = computed(() => this.scheduleService.date() === todayIso());

  readonly zoneView   = signal<DayZoneView | null>(null);
  readonly anchors    = signal<TimezoneAnchorDto[]>([]);
  readonly whyOpen    = signal<TimezoneAnchorDto | null>(null);

  protected readonly toastMessage = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  readonly editingId = signal<string | null>(null);

  /**
   * Spotlight rule: a row dims (and goes inert) while *another* row is being
   * edited. A meal row stays lit when the editor targets the meal itself or one
   * of its during-meal tasks, so the hosted edit form remains interactive.
   * Task rows have no nested tasks, so the anchor check is a no-op for them.
   */
  protected isSpotlightDimmed(item: ScheduleItem): boolean {
    const editing = this.editingId();
    if (editing === null || editing === item.id) return false;
    if (isMealAnchor(item) && item.duringMealTasks.some(t => t.id === editing)) return false;
    return true;
  }

  openEditor(id: string): void {
    this.editingId.set(id);
    queueMicrotask(() => {
      document.getElementById(`task-row-${id}`)
        ?.scrollIntoView({ block: 'nearest', behavior: this.prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  }
  closeEditor(): void {
    // Restore focus to the originating row's label. Capture the id before
    // clearing; once editingId is null the row is no longer inert, so the
    // queued focus call succeeds.
    const id = this.editingId();
    this.editingId.set(null);
    if (id) {
      queueMicrotask(() =>
        document.querySelector<HTMLElement>(`#task-row-${id} .label`)?.focus());
    }
  }
  onEditSave(id: string, patch: TaskEditPatch): void { this.scheduleService.updateEntry(id, patch); }

  private prefersReducedMotion(): boolean {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  ngOnInit(): void {
    this.route.params
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const date = params['date'] as string;
        this.scheduleService.loadDay(date);
        if (this.isToday()) {
          this.briefingService.load(date);
        }
        this.loadZoneView(date);
      });
  }

  private loadZoneView(date: string): void {
    this.tz.listAnchors(date)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.anchors.set(list);
          const currentZone = this.tz.deviceZone();
          this.zoneView.set(classifyDay(list, date, currentZone));
        },
        error: () => {
          // Never break the day on a timezone error.
          this.zoneView.set(null);
        },
      });
  }

  onDateChange(date: string): void { this.router.navigate(['/day', date]); }
  retry(): void { this.scheduleService.loadDay(this.scheduleService.date()); }
  onItemAdded(_entry: AddedEntry): void {
    this.scheduleService.loadDay(this.scheduleService.date());
  }

  openWhyForGoverning(): void {
    const view = this.zoneView();
    if (!view) return;
    // Travel days: the switch anchor is the governing anchor.
    if (view.kind === 'travel' && view.switch) {
      this.whyOpen.set(view.switch.anchor);
      return;
    }
    // Divergent: find the most-recent anchor at/before the current date.
    const date = this.scheduleService.date();
    const sorted = [...this.anchors()].sort((a, b) =>
      b.effective_date.localeCompare(a.effective_date));
    const governing = sorted.find(a => a.effective_date <= date);
    if (governing) this.whyOpen.set(governing);
  }

  openWhy(anchor: TimezoneAnchorDto): void {
    this.whyOpen.set(anchor);
  }

  onUseCurrent(anchor: TimezoneAnchorDto): void {
    const reload = () => {
      const date = this.scheduleService.date();
      this.scheduleService.loadDay(date);
      this.loadZoneView(date);
    };
    // Use explicit subscribe to avoid a union-type inference issue with pipe.
    if (anchor.source === 'inferred' && anchor.inference_group) {
      this.tz.deleteGroup(anchor.inference_group)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: () => { this.whyOpen.set(null); reload(); }, error: () => { this.whyOpen.set(null); reload(); } });
    } else {
      this.tz.deleteAnchor(anchor.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: () => { this.whyOpen.set(null); reload(); }, error: () => { this.whyOpen.set(null); reload(); } });
    }
  }

  onPickZone(_anchor: TimezoneAnchorDto, zone: string): void {
    this.tz.createAnchor({ effective_date: this.scheduleService.date(), zone })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.whyOpen.set(null);
          const date = this.scheduleService.date();
          this.scheduleService.loadDay(date);
          this.loadZoneView(date);
        },
        error: () => {
          this.whyOpen.set(null);
        },
      });
  }

  ngOnDestroy(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  onTaskConfirmed(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastMessage.set(message);
    this.toastTimer = setTimeout(() => this.toastMessage.set(null), 5000);
  }

  closeToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastMessage.set(null);
  }
}
