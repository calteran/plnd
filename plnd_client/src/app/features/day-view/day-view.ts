import { Component, DestroyRef, ElementRef, HostListener, OnDestroy, OnInit, Renderer2, computed, effect, inject, signal, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule } from '@angular/cdk/drag-drop';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ScheduleService, RepositionTarget } from '../../core/services/schedule.service';
import { DayLayout, MoveResult, stepWithinDay, describeMove } from '../../core/utils/reorder-navigation';
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
          <div class="schedule-list" #scheduleList>
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
                    [taskCaps]="moveCaps()"
                    [dropListId]="'meal-' + group.anchor.id"
                    [connectedTo]="allDropListIds()"
                    (moveTaskUp)="onKeyboardMove($event, 'up')"
                    (moveTaskDown)="onKeyboardMove($event, 'down')"
                    (dragStarted)="onDragStarted()"
                    (dragEnded)="onDragEnded()"
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
                      (cdkDragStarted)="onDragStarted()"
                      (cdkDragEnded)="onDragEnded()"
                      [id]="'task-row-' + task.id"
                      [class.dimmed]="isSpotlightDimmed(task)"
                      [attr.inert]="isSpotlightDimmed(task) ? '' : null"
                      [item]="task"
                      [editing]="editingId() === task.id"
                      [canMoveUp]="moveCaps().get(task.id)?.up ?? false"
                      [canMoveDown]="moveCaps().get(task.id)?.down ?? false"
                      (moveUp)="onKeyboardMove($event, 'up')"
                      (moveDown)="onKeyboardMove($event, 'down')"
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
  private  readonly renderer         = inject(Renderer2);
  private  readonly announcer        = inject(LiveAnnouncer);

  /** The schedule list element — host of the drag-only `dragging` class. */
  private readonly scheduleList = viewChild<ElementRef<HTMLElement>>('scheduleList');

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

  /**
   * A stashed focus request that survives the async loadDay re-sync. Set when a
   * keyboard move runs; cleared after focus has been re-applied following the
   * loadDay re-sync (i.e., the second applyPendingFocus pass). The constructor
   * effect re-applies it after slotGroups() re-emits — see
   * refocusReorderButton / applyPendingFocus.
   */
  private readonly pendingFocus = signal<{ taskId: string; dir: 'up' | 'down' } | null>(null);

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

      // After a loadDay re-sync rebuilds the rows, re-apply any pending keyboard
      // focus. setTimeout(0) defers focus until after Angular's change detection
      // has run (a microtask would fire before CD, focusing a button that CD then
      // immediately disables — causing the browser to drop focus to body). This
      // effect re-runs because it reads slotGroups(), which the reload re-emits.
      // Pass fromReSync=true so applyPendingFocus clears pendingFocus after this
      // second pass (the optimistic pass left it set for the re-sync pass to clear).
      setTimeout(() => this.applyPendingFocus(true), 0);
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
   * Day layout in reading order: each meal group emits its during-meal list then
   * its slot list. Built from the mutable maps (not slotGroups()) so it tracks
   * optimistic keyboard moves between the persist and the loadDay re-sync.
   */
  readonly dayLayout = computed<DayLayout>(() => {
    const layout: DayLayout = [];
    for (const g of this.scheduleService.slotGroups()) {
      if (g.anchor && isMealAnchor(g.anchor)) {
        const meal = this.mealAnchor(g.anchor.id);
        layout.push({ slotKey: g.anchor.id, kind: 'meal', taskIds: (meal?.duringMealTasks ?? []).map(t => t.id) });
      }
      layout.push({ slotKey: g.anchorLabel, kind: 'slot', taskIds: this.slotTasks(g.anchorLabel).map(t => t.id) });
    }
    return layout;
  });

  /** Per-task move capability for the template + meal-row. */
  readonly moveCaps = computed(() => {
    const layout = this.dayLayout();
    const caps = new Map<string, { up: boolean; down: boolean }>();
    for (const slot of layout) {
      for (const id of slot.taskIds) {
        caps.set(id, { up: stepWithinDay(layout, id, 'up') !== null, down: stepWithinDay(layout, id, 'down') !== null });
      }
    }
    return caps;
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

  /**
   * Open the floating-task slot gaps for the duration of a drag.
   *
   * The class is toggled by a SYNCHRONOUS DOM mutation (Renderer2.addClass),
   * NOT an Angular binding (`[class.dragging]` / a signal). This is load-bearing,
   * not a style choice — do not "simplify" it into a binding:
   *
   *   CDK caches each slot drop-list's hit-rect at drag *start*, inside
   *   DropListRef._startReceiving (@angular/cdk drag-drop.mjs ~L1007), which runs
   *   in the same synchronous tick immediately after `cdkDragStarted` fires
   *   (~L1003). An empty `.slot-drop-list` is zero-height, so unless the
   *   `min-height` is already in effect at that instant CDK caches a zero-height
   *   rect and the slot can never receive a drop (the #1000 bug). A host/class
   *   binding applies on the *next* change-detection tick — too late. A direct
   *   classList mutation here lands before the caching, so the CSS rule
   *   `.schedule-list.dragging .slot-drop-list { min-height }` is live in time.
   *
   * `cdkDragStarted`/`cdkDragEnded` are synchronous EventEmitters, and so is the
   * `dragStarted`/`dragEnded` re-emit from meal-row, so drags originating in a
   * during-meal list reach this handler synchronously too.
   */
  onDragStarted(): void {
    const el = this.scheduleList()?.nativeElement;
    if (el) this.renderer.addClass(el, 'dragging');
  }

  /**
   * Collapse the slot gaps again once the drag ends — keeps the resting layout tight.
   *
   * Also bound to document pointer-release events as a safety net: CDK's
   * `CdkDrag.dispose()` *completes* the `ended` emitter without emitting, so if
   * the dragged row is torn down mid-drag (e.g. a `loadDay()` resolves and
   * `@for…track id` drops it) `(cdkDragEnded)` never fires and the `dragging`
   * class would stay stuck on, reintroducing the resting gap. A physical release
   * always fires one of these — the same events CDK itself ends a drag on. Bound
   * via `@HostListener` (not `Renderer2.listen('document', …)`) so Angular tears
   * the listeners down on destroy — a routed component would otherwise leak them.
   * Idempotent with the normal `(cdkDragEnded)` path (`removeClass` no-ops if absent).
   */
  @HostListener('document:mouseup')
  @HostListener('document:touchend')
  @HostListener('document:touchcancel')
  onDragEnded(): void {
    const el = this.scheduleList()?.nativeElement;
    if (el) this.renderer.removeClass(el, 'dragging');
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

  /** Find the mutable array + index holding a task id across slot maps and meal clones. */
  private findTaskArray(taskId: string): { arr: ScheduleTask[]; index: number } | null {
    for (const arr of this.slotGroupMap().values()) {
      const i = arr.findIndex(t => t.id === taskId);
      if (i !== -1) return { arr, index: i };
    }
    for (const meal of this.mealAnchorMap().values()) {
      const i = meal.duringMealTasks.findIndex(t => t.id === taskId);
      if (i !== -1) return { arr: meal.duringMealTasks, index: i };
    }
    return null;
  }

  /** Target mutable array for a resolved MoveResult slot key. */
  private targetArray(result: MoveResult): ScheduleTask[] | null {
    return result.kind === 'meal'
      ? this.mealAnchorMap().get(result.slotKey)?.duringMealTasks ?? null
      : this.slotGroupMap().get(result.slotKey) ?? null;
  }

  /** Display label for a slot key (meal name for a meal, the capitalized anchor label otherwise). */
  private slotLabel(result: MoveResult): string {
    if (result.kind === 'meal') return this.mealAnchor(result.slotKey)?.name ?? 'meal';
    return result.slotKey === 'start of day' ? 'start of day' : `after ${result.slotKey}`;
  }

  /**
   * Keyboard / button reorder handler. Mirrors onSlotDrop/onMealDrop: resolve the
   * one-step move via the pure helper, apply it optimistically to the right
   * mutable array, re-render, announce, persist (reusing persistReposition), and
   * follow focus to the moved row.
   */
  onKeyboardMove(taskId: string, dir: 'up' | 'down'): void {
    const result = stepWithinDay(this.dayLayout(), taskId, dir);
    if (!result) return; // at the day edge — control was disabled anyway
    const src = this.findTaskArray(taskId);
    const dst = this.targetArray(result);
    if (!src || !dst) return;

    // Capture source meal name (for an out-of-meal announcement) before mutating.
    const sourceMeal = [...this.mealAnchorMap().values()].find(m => m.duringMealTasks.some(t => t.id === taskId));

    const [moved] = src.arr.splice(src.index, 1);
    dst.splice(result.index, 0, moved);

    // Trigger OnPush re-render by re-setting the signal maps (mutated in place).
    this.slotGroupMap.set(new Map(this.slotGroupMap()));
    this.mealAnchorMap.set(new Map(this.mealAnchorMap()));

    this.announcer.announce(describeMove({
      crossing: result.crossing, dir,
      targetLabel: this.slotLabel(result),
      sourceLabel: sourceMeal?.name,
    }), 'polite');

    const target = result.kind === 'meal' ? { mealAnchorId: result.slotKey } : { afterAnchor: result.slotKey };
    this.persistReposition(moved.id, target, result.index);
    this.refocusReorderButton(taskId, dir);
  }

  /**
   * Re-focus the moved task's control. Runs once immediately (the optimistic
   * re-render already placed the button) AND again after the async loadDay
   * re-sync rebuilds the rows — the second pass is why we stash a pending focus
   * request that the constructor effect re-applies (via `fromReSync=true`) once
   * slotGroups() re-emits. The re-sync pass clears the request after applying it.
   */
  private refocusReorderButton(taskId: string, dir: 'up' | 'down'): void {
    this.pendingFocus.set({ taskId, dir });
    // setTimeout(0) rather than queueMicrotask: microtasks fire before Angular's
    // change detection, so the moved button's [disabled] binding hasn't updated
    // yet — focusing an about-to-be-disabled button causes the browser to
    // immediately drop focus to <body> once CD disables it. A macro-task delay
    // ensures CD has re-rendered the row (with correct disabled states) before
    // we read them to pick the best focus target.
    setTimeout(() => this.applyPendingFocus(false), 0);
  }

  /**
   * @param fromReSync true when called from the constructor effect after a
   *   loadDay re-sync; false when called from the initial optimistic pass.
   *   On the initial pass we leave the request set so the effect's second call
   *   (after the HTTP round-trip) re-applies focus to the rebuilt row — preventing
   *   the DOM rebuild from silently dropping focus. The re-sync pass clears it.
   */
  private applyPendingFocus(fromReSync: boolean): void {
    const req = this.pendingFocus();
    if (!req) return;
    const row = document.getElementById(`task-row-${req.taskId}`);
    if (!row) return; // row absent (rolled back / not yet rebuilt) — leave pending for the next pass

    // The reorder buttons have `visibility: hidden` by default and are only
    // revealed via `:focus-within` on `.task-row`. This means we CANNOT focus
    // them directly — a `visibility: hidden` element refuses `focus()`.
    // Strategy: focus the `.label` first (always visible, always focusable),
    // which gives the row `:focus-within` and makes the buttons visible.
    // Then focus the preferred button if it is not disabled.
    const label = row.querySelector<HTMLElement>('.label');
    label?.focus(); // give the row :focus-within so buttons become focusable

    const same = row.querySelector<HTMLButtonElement>(`[data-testid="reorder-${req.dir}"]`);
    if (same && !same.disabled) {
      same.focus();
      if (fromReSync) { this.pendingFocus.set(null); }
      return;
    }
    const other = row.querySelector<HTMLButtonElement>(`[data-testid="reorder-${req.dir === 'up' ? 'down' : 'up'}"]`);
    if (other && !other.disabled) {
      other.focus();
      if (fromReSync) { this.pendingFocus.set(null); }
      return;
    }
    // Both buttons are disabled (impossible in theory — always one enabled unless
    // the slot has only one task). Fall back to the label we already focused.
    this.pendingFocus.set(null);
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
