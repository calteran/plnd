import { MealAnchor, ScheduleItem, ScheduleTask, SlotGroup, parseItemType } from '../models/schedule';
import { ScheduleAnchorDto, ScheduleEntryDto } from '../models/week-plan';
import { PlannedMealEntryDto } from '../models/planned-meal-entry';

const MEAL_SLOTS: Record<string, { name: string; emoji: string }> = {
  breakfast: { name: 'Breakfast', emoji: '🥣' },
  lunch:     { name: 'Lunch',     emoji: '🥗' },
  dinner:    { name: 'Dinner',    emoji: '🍽' },
};

/** Folds backend consumption status into the UI MealAnchor.status. */
export function toMealUiStatus(status: string | undefined, description?: string): MealAnchor['status'] {
  if (status === 'consumed') return 'done';
  if (status === 'skipped') return 'skipped';
  return description ? 'planned' : 'unplanned';
}

function mapAnchorInstance(
  dto: ScheduleAnchorDto,
  planned?: PlannedMealEntryDto,
  duringMealTasks: ScheduleTask[] = [],
): MealAnchor {
  const slot = MEAL_SLOTS[dto.label.toLowerCase()];
  return {
    id: dto.id as string,
    name: slot?.name ?? dto.label,
    emoji: slot?.emoji ?? '🍴',
    status: toMealUiStatus(dto.status ?? 'planned', planned?.title ?? undefined),
    description: planned?.title ?? undefined,
    duringMealTasks,
  };
}

function mapEntry(e: ScheduleEntryDto): ScheduleTask {
  // Floating = lives in a slot (after_anchor) with no fixed clock time.
  const floating = !e.scheduled_start && !!e.after_anchor;
  return {
    id: e.entry_id,
    type: parseItemType(e.task_type),
    label: e.title ?? e.task_type,
    status: e.status === 'completed' ? 'done' : 'pending',
    scheduledStart: e.scheduled_start ?? undefined,
    durationMinutes: e.duration_minutes ?? undefined,
    energy: (e.energy_required as ScheduleTask['energy']) ?? undefined,
    oneShot: e.one_shot ?? false,
    floating,
  };
}

/**
 * Assemble the ordered slot/anchor sequence (§4.9). Walks `anchors` (pre-sorted
 * by `sequence`) and interleaves floating tasks into the slot after their matched
 * anchor. Every task either has an anchor (`after_anchor`) or is one
 * (`scheduled_start`); during-meal tasks nest via `slot_meal_anchor_id`.
 */
export function assembleScheduleItems(
  anchors: ScheduleAnchorDto[],
  entries: ScheduleEntryDto[],
  plannedMeals: PlannedMealEntryDto[],
): ScheduleItem[] {
  const mealByAnchor = new Map<string, PlannedMealEntryDto>(
    (plannedMeals ?? []).map(pm => [pm.meal_anchor_instance_id, pm]),
  );
  const mealAnchorIds = new Set(
    anchors.filter(a => a.kind === 'meal' && a.id !== null).map(a => a.id as string),
  );

  const duringByAnchor = new Map<string, ScheduleTask[]>();
  const scheduledByEntryId = new Map<string, ScheduleTask>();
  const floatingByLabel = new Map<string, ScheduleTask[]>();
  const orphans: ScheduleTask[] = [];

  for (const e of entries) {
    const mealAnchorId = e.slot_meal_anchor_id;
    // Precedence: `slot_meal_anchor_id` wins over `scheduled_start`. An entry with
    // both nests in its meal row here; the backend may still emit a scheduled_task
    // anchor for it, which then matches no entry and acts as an invisible boundary.
    if (mealAnchorId && mealAnchorIds.has(mealAnchorId)) {
      const list = duringByAnchor.get(mealAnchorId) ?? [];
      list.push(mapEntry(e));
      duringByAnchor.set(mealAnchorId, list);
    } else if (mealAnchorId) {
      console.warn(`Task ${e.entry_id} references unknown meal anchor "${mealAnchorId}"; rendering at top`);
      orphans.push(mapEntry(e));
    } else if (e.scheduled_start) {
      scheduledByEntryId.set(e.entry_id, mapEntry(e));
    } else if (e.after_anchor) {
      const key = e.after_anchor.toLowerCase();
      const list = floatingByLabel.get(key) ?? [];
      list.push(mapEntry(e));
      floatingByLabel.set(key, list);
    } else {
      console.warn(`Task ${e.entry_id} has neither an anchor nor a fixed start; rendering at top`);
      orphans.push(mapEntry(e));
    }
  }

  const items: ScheduleItem[] = [];
  const matchedLabels = new Set<string>();
  const emittedScheduled = new Set<string>();

  for (const a of anchors) {
    if (a.kind === 'meal') {
      const id = a.id as string;
      items.push(mapAnchorInstance(a, mealByAnchor.get(id), duringByAnchor.get(id) ?? []));
    } else if (a.kind === 'scheduled_task') {
      const id = a.id as string;
      const task = scheduledByEntryId.get(id);
      if (task) { items.push(task); emittedScheduled.add(id); }
    }
    // start_of_day / end_of_day / timezone_change emit no row.

    const label = a.label.toLowerCase();
    if (!matchedLabels.has(label)) {
      const floats = floatingByLabel.get(label);
      if (floats) { items.push(...floats); matchedLabels.add(label); }
    }
  }

  // Defensive: never drop data. Unresolved floats + any scheduled task whose
  // anchor was absent surface rather than vanish. Expected to be empty.
  const leftover: ScheduleTask[] = [...orphans];
  for (const [label, tasks] of floatingByLabel) {
    if (!matchedLabels.has(label)) {
      console.warn(`Floating task(s) reference unknown anchor "${label}"; rendering at top`);
      leftover.push(...tasks);
    }
  }
  for (const [id, task] of scheduledByEntryId) {
    if (!emittedScheduled.has(id)) {
      console.warn(`Scheduled task ${id} has no anchor in the sequence; rendering at top`);
      leftover.push(task);
    }
  }

  return [...leftover, ...items];
}

/**
 * Produce a flat list of droppable slot groups — one per anchor in sequence
 * order — each carrying the floating tasks that live after that anchor.
 * Used by the day-view template to render CDK drop lists (Task 9+).
 */
export function assembleSlotGroups(
  anchors: ScheduleAnchorDto[],
  entries: ScheduleEntryDto[],
  plannedMeals: PlannedMealEntryDto[],
): SlotGroup[] {
  const mealAnchorIds = new Set(
    anchors.filter(a => a.kind === 'meal' && a.id !== null).map(a => a.id as string),
  );

  // Partition floating tasks by their after_anchor label (lowercased).
  // Entries appear in backend sort order (by slot_position), so insertion
  // order gives us the correct arrival order within each slot.
  const floatingByLabel = new Map<string, ScheduleTask[]>();
  // Index scheduled tasks by their entry_id so we can resolve scheduled_task
  // anchors below.
  const scheduledById = new Map<string, ScheduleTask>();
  // Index during-meal tasks by their meal anchor id.
  const duringByMealId = new Map<string, ScheduleTask[]>();
  for (const e of entries) {
    const mealAnchorId = e.slot_meal_anchor_id;
    if (mealAnchorId && mealAnchorIds.has(mealAnchorId)) {
      const list = duringByMealId.get(mealAnchorId) ?? [];
      list.push(mapEntry(e));
      duringByMealId.set(mealAnchorId, list);
      continue;
    }
    if (e.scheduled_start) {
      scheduledById.set(e.entry_id, mapEntry(e));
      continue;                          // scheduled — is an anchor itself
    }
    if (!e.after_anchor) continue;       // orphan — no slot to place it in
    const key = e.after_anchor.toLowerCase();
    const list = floatingByLabel.get(key) ?? [];
    list.push(mapEntry(e));
    floatingByLabel.set(key, list);
  }

  const mealByAnchor = new Map<string, PlannedMealEntryDto>(
    (plannedMeals ?? []).map(pm => [pm.meal_anchor_instance_id, pm]),
  );

  const groups: SlotGroup[] = [];
  const seen = new Set<string>();
  for (const a of anchors) {
    const label = a.label.toLowerCase();
    if (seen.has(label)) continue;
    seen.add(label);

    let anchor: SlotGroup['anchor'] = null;
    if (a.kind === 'meal' && a.id) {
      anchor = mapAnchorInstance(a, mealByAnchor.get(a.id), duringByMealId.get(a.id) ?? []);
    } else if (a.kind === 'scheduled_task' && a.id) {
      anchor = scheduledById.get(a.id) ?? null;
    }
    groups.push({ anchorLabel: label, anchor, tasks: floatingByLabel.get(label) ?? [] });
  }

  return groups;
}
