// e2e: floating tasks render in their slots across the day (#959).
//
// Seeds a single day with:
//   - Breakfast and Lunch meal anchors (per-date, via seedMealAnchor)
//   - A scheduled task ("Standup") at a fixed time (via seedScheduleEntries placed_tasks)
//   - Three floating tasks: after_anchor='start of day', 'breakfast', 'standup'
//
// Then asserts the rendered row order (innerText positions) proves each floating
// task appears in the correct slot — after its anchor, before the next one.
//
// Policy: all user data flows through the real backend; no page.route() mocks on
// schedule data; per-test user isolation via seedAuth.

import { test, expect } from '../fixtures';
import { DayViewPage } from '../pages/day-view.page';
import { seedAuth } from '../helpers/auth';
import { seedMealAnchor, seedScheduleEntries } from '../helpers/seed-data';

const TEST_DATE = '2026-04-07'; // Tuesday, well inside the planning window
const PLAN_START = '2026-04-06'; // Monday
const PLAN_END   = '2026-04-12'; // Sunday

test.describe('Day View — floating tasks render in their slots', () => {

  test('floating tasks appear after their anchors in the correct order', async ({ page }) => {
    const { sub } = await seedAuth(page);

    // Seed per-date meal anchors (sorted by preferred_time so Breakfast < Lunch)
    await seedMealAnchor(sub, { date: TEST_DATE, name: 'breakfast', preferred_time: '08:00' });
    await seedMealAnchor(sub, { date: TEST_DATE, name: 'lunch',     preferred_time: '12:00' });

    // Seed all tasks in a single planning week:
    //   - Standup: a scheduled task at 10:00 (between Breakfast and Lunch by time)
    //   - Take meds: floating, after_anchor='start of day'
    //   - Walk the dog: floating, after_anchor='breakfast'
    //   - Reply to email: floating, after_anchor='standup'
    await seedScheduleEntries(sub, {
      plan_start: PLAN_START,
      plan_end:   PLAN_END,
      placed_tasks: [
        {
          date:             TEST_DATE,
          task_type:        'general',
          title:            'Standup',
          scheduled_start:  '10:00:00',
        },
        {
          date:         TEST_DATE,
          task_type:    'general',
          title:        'Take meds',
          after_anchor: 'start of day',
        },
        {
          date:         TEST_DATE,
          task_type:    'general',
          title:        'Walk the dog',
          after_anchor: 'breakfast',
        },
        {
          date:         TEST_DATE,
          task_type:    'general',
          title:        'Reply to email',
          after_anchor: 'standup',
        },
      ],
    });

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TEST_DATE);

    // Wait for the schedule to finish loading
    await expect(dayView.getScheduleList()).toBeVisible();

    // Collect all task and meal rows in rendered DOM order. Use a descendant
    // (not direct-child) combinator: anchor rows are direct children of
    // .schedule-list, but floating tasks render inside per-slot .slot-drop-list
    // wrappers, so a `>` combinator silently misses them (and the join would
    // never contain the floating task titles).
    const rows = page.locator('.schedule-list app-task-row, .schedule-list app-meal-row');
    await expect(rows.first()).toBeVisible();

    // Join all row texts into a single newline-delimited string; indexOf gives
    // relative positions that encode DOM order.
    const texts = await rows.allInnerTexts();
    const joined = texts.join('\n');

    const idx = (s: string) => joined.indexOf(s);

    // Each anchor must be present
    expect(idx('Take meds')).toBeGreaterThanOrEqual(0);
    expect(idx('Breakfast')).toBeGreaterThanOrEqual(0);
    expect(idx('Walk the dog')).toBeGreaterThanOrEqual(0);
    expect(idx('Standup')).toBeGreaterThanOrEqual(0);
    expect(idx('Reply to email')).toBeGreaterThanOrEqual(0);
    expect(idx('Lunch')).toBeGreaterThanOrEqual(0);

    // Slot ordering: start-of-day float → Breakfast → breakfast float →
    //               Standup → standup float → Lunch
    expect(idx('Take meds')).toBeLessThan(idx('Breakfast'));
    expect(idx('Breakfast')).toBeLessThan(idx('Walk the dog'));
    expect(idx('Walk the dog')).toBeLessThan(idx('Standup'));
    expect(idx('Standup')).toBeLessThan(idx('Reply to email'));
    expect(idx('Reply to email')).toBeLessThan(idx('Lunch'));
  });

});
