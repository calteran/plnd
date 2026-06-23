import { Component, DestroyRef, OnDestroy, OnInit, computed, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule } from '@angular/cdk/drag-drop';
import { ScheduleService, RepositionTarget } from '../../core/services/schedule.service';
import { todayIso } from '../../core/utils/date-only';
import { BriefingService } from '../../core/services/briefing.service';
import { TimezoneService } from '../../core/services/timezone.service';
import { isMealAnchor, MealAnchor, ScheduleItem, ScheduleTask, TaskEditPatch } from '../../core/models/schedule';
import { DayZoneViewDto, TimezoneAnchorDto } from '../../core/models/timezone';
import { DaySwitch, DayZoneView } from '../../core/utils/zone-projection';
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
    DragDropModule,
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
          [sourceLabel]="a.source_title"
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
            @for (group of scheduleService.slotGroups(); track group.anchorLabel) {
              @if (group.anchor !== null) {
                @if (isMealAnchor(group.anchor)) {
                  @let mealClone = mealAnchor(group.anchor.id);
                  @if (mealClone) {
                  <app-meal-row
                    [id]="'task-row-' + group.anchor.id"
                    [class.dimmed]="isSpotlightDimmed(group.anchor)"
                    [attr.inert]="isSpotlightDimmed(group.anchor) ? '' : null"
                    [meal]="mealClone"
                    [date]="scheduleService.date()"
                    [editingId]="editingId()"
                    [dropListId]="'meal-' + group.anchor.id"
                    [connectedTo]="allDropListIds()"
                    (mealDrop)="onMealDrop($event, group.anchor.id)"
                    (editRequested)="openEditor($event)"
                    (save)="onEditSave(editingId()!, $event)"
                    (closed)="closeEditor()"
                    (toggled)="scheduleService.toggleItem($event)"
                    (doneToggle)="scheduleService.toggleMealConsumed($event)"
                    (skipped)="scheduleService.setMealConsumption($event, 'skipped')"
                  />
                  }
                } @else {
                  <app-task-row
                    [id]="'task-row-' + group.anchor.id"
                    [class.dimmed]="isSpotlightDimmed(group.anchor)"
                    [attr.inert]="isSpotlightDimmed(group.anchor) ? '' : null"
                    [item]="group.anchor"
                    [editing]="editingId() === group.anchor.id"
                    (editRequested)="openEditor($event)"
                    (save)="onEditSave(group.anchor.id, $event)"
                    (closed)="closeEditor()"
                    (toggled)="scheduleService.toggleItem($event)"
                  />
                }
              }
              <div
                  cdkDropList
                  [id]="'slot-' + group.anchorLabel"
                  [cdkDropListData]="slotTasks(group.anchorLabel)"
                  [cdkDropListConnectedTo]="allDropListIds()"
                  (cdkDropListDropped)="onSlotDrop($event, group.anchorLabel)"
                  class="slot-drop-list"
                >
                  @for (task of slotTasks(group.anchorLabel); track task.id) {
                    <app-task-row
                      cdkDrag
                      [cdkDragData]="task"
                      [id]="'task-row-' + task.id"
                      [class.dimmed]="isSpotlightDimmed(task)"
                      [attr.inert]="isSpotlightDimmed(task) ? '' : null"
                      [item]="task"
                      [editing]="editingId() === task.id"
                      (editRequested)="openEditor($event)"
                      (save)="onEditSave(task.id, $event)"
                      (closed)="closeEditor()"
                      (toggled)="scheduleService.toggleItem($event)"
                    />
                  }
                </div>
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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
   * Mutable per-slot task lists keyed by anchorLabel.
   * CDK mutates these arrays in place on drop; built (with fresh copies) each
   * time the service emits a new slotGroups value.
   */
  readonly slotGroupMap = signal<Map<string, ScheduleTask[]>>(new Map());

  /**
   * Mutable per-meal anchor clones keyed by meal id.
   * Each clone's `duringMealTasks` is a copied array — CDK and drop handlers
   * operate only on these copies, never on the service's slotGroups() objects.
   * Rebuilt (with fresh clones) each time the service emits a new snapshot.
   */
  readonly mealAnchorMap = signal<Map<string, MealAnchor>>(new Map());

  constructor() {
    // Rebuild mutable slot map and meal-anchor map whenever the service emits a
    // fresh slot-groups snapshot. Use effect() so the rebuild runs inside the
    // Angular signal graph and triggers OnPush change detection automatically.
    effect(() => {
      const groups = this.scheduleService.slotGroups();
      const slotMap = new Map<string, ScheduleTask[]>();
      const mealMap = new Map<string, MealAnchor>();
      for (const g of groups) {
        slotMap.set(g.anchorLabel, [...g.tasks]);
        if (g.anchor && isMealAnchor(g.anchor)) {
          // Shallow-clone the meal anchor with a copied duringMealTasks array so
          // CDK can mutate it in place without touching the service's snapshot.
          mealMap.set(g.anchor.id, { ...g.anchor, duringMealTasks: [...g.anchor.duringMealTasks] });
        }
      }
      this.slotGroupMap.set(slotMap);
      this.mealAnchorMap.set(mealMap);
    });
  }

  /** Returns the mutable task array for a given slot label (empty array if unknown). */
  slotTasks(anchorLabel: string): ScheduleTask[] {
    return this.slotGroupMap().get(anchorLabel) ?? [];
  }

  /** Returns the day-view-owned mutable clone of a meal anchor (undefined if unknown). */
  mealAnchor(mealId: string): MealAnchor | undefined {
    return this.mealAnchorMap().get(mealId);
  }

  /**
   * IDs of all CDK drop lists: one per slot and one per meal's during-meal list.
   * A `computed` so the template's repeated `allDropListIds()` calls per change
   * detection memoize against `slotGroups()` (matches `PlanDayCardComponent`).
   */
  readonly allDropListIds = computed(() => {
    const ids: string[] = [];
    for (const g of this.scheduleService.slotGroups()) {
      ids.push(`slot-${g.anchorLabel}`);
      if (g.anchor && isMealAnchor(g.anchor)) {
        ids.push(`meal-${g.anchor.id}`);
      }
    }
    return ids;
  });

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
    forkJoin({
      anchors: this.tz.listAnchors(date),
      resolved: this.tz.resolve(date, undefined, this.tz.deviceZone()),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ anchors, resolved }) => {
          this.anchors.set(anchors);
          this.zoneView.set(this.toZoneView(resolved.day_view ?? null, anchors));
        },
        error: () => {
          // Never break the day on a timezone error (listAnchors or resolve).
          // anchors stays empty; zoneView stays null — why-panel will not open.
          this.zoneView.set(null);
        },
      });
  }

  /** Map the server day_view onto the view model, resolving the switch anchor's
   *  full DTO from the already-fetched anchor list (needed by the why-panel). */
  private toZoneView(dv: DayZoneViewDto | null, anchors: TimezoneAnchorDto[]): DayZoneView | null {
    if (!dv) return null;
    let sw: DaySwitch | undefined;
    if (dv.kind === 'travel' && dv.switch) {
      const swDto = dv.switch;
      const anchor = anchors.find(a => a.id === swDto.anchor_id);
      if (anchor) sw = { fromZone: swDto.from_zone, toZone: swDto.to_zone, anchor };
    }
    return { kind: dv.kind, incomingZone: dv.incoming_zone, currentZone: dv.current_zone, switch: sw };
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

  /** Drop handler for a slot's floating task list. */
  onSlotDrop(event: CdkDragDrop<ScheduleTask[]>, anchorLabel: string): void {
    const tasks = event.container.data;
    if (event.previousContainer === event.container) {
      moveItemInArray(tasks, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        tasks,
        event.previousIndex,
        event.currentIndex,
      );
    }
    const moved = tasks[event.currentIndex];
    this.persistReposition(
      moved.id,
      { afterAnchor: anchorLabel },
      event.currentIndex,
    );
  }

  /** Drop handler for a meal's during-meal task list. */
  onMealDrop(event: CdkDragDrop<ScheduleTask[]>, mealAnchorId: string): void {
    const tasks = event.container.data;
    if (event.previousContainer === event.container) {
      moveItemInArray(tasks, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        tasks,
        event.previousIndex,
        event.currentIndex,
      );
    }
    const moved = tasks[event.currentIndex];
    this.persistReposition(moved.id, { mealAnchorId }, event.currentIndex);
  }

  private persistReposition(
    entryId: string,
    target: RepositionTarget,
    position: number,
  ): void {
    this.scheduleService
      .repositionTask(entryId, this.scheduleService.date(), target, position)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Re-sync ScheduleService signals with the persisted order. Without
          // this, only the local DayViewComponent maps reflect the move; a
          // later service update (e.g. a task toggle) would rebuild those maps
          // from the still-stale `slotGroups()` snapshot and revert the drag.
          this.scheduleService.loadDay(this.scheduleService.date());
        },
        error: () => {
          // Roll back the optimistic move by re-fetching authoritative state.
          this.scheduleService.loadDay(this.scheduleService.date());
          this.onTaskConfirmed('Could not move task — please try again.');
        },
      });
  }
}
