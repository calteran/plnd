import { test, expect } from '../fixtures';
import { seedAuth } from '../helpers/auth';
import { seedTimezoneAnchor, listTimezoneAnchors } from '../helpers/seed-timezone';
import { seedScheduleEntries } from '../helpers/seed-data';
import { DayViewPage } from '../pages/day-view.page';

// ── Constants ────────────────────────────────────────────────────────────────

// Travel day: a future date with an intra-day timezone switch (flight landing).
const TRAVEL_DATE = '2026-08-10';
// The plan window that covers the travel date (Monday–Sunday).
const PLAN_START = '2026-08-10';
const PLAN_END   = '2026-08-16';
// Destination zone (intra-day switch on TRAVEL_DATE).
const DEST_ZONE  = 'Pacific/Honolulu';
// A downstream day entirely in the destination zone (the day after travel).
const DOWNSTREAM_DATE = '2026-08-11';

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Timezone surfacing — day view', () => {

  let sub: string;

  test.beforeEach(async ({ page }) => {
    const auth = await seedAuth(page);
    sub = auth.sub;

    // Seed schedule entries for the travel week so the schedule list renders.
    // Without at least one item the `.schedule-list` div (and the switch row
    // inside it) won't be in the DOM.
    await seedScheduleEntries(sub, {
      plan_start: PLAN_START,
      plan_end:   PLAN_END,
      placed_tasks: [
        {
          date: TRAVEL_DATE,
          task_type: 'general',
          title: 'Flight to Honolulu',
          scheduled_start: '10:00:00',
        },
        {
          date: DOWNSTREAM_DATE,
          task_type: 'general',
          title: 'Beach walk',
          scheduled_start: '08:00:00',
        },
      ],
    });
  });

  // ── Travel day: switch row visible ─────────────────────────────────────────

  test('travel-day inline switch row is visible when intra-day anchor exists', async ({ page }) => {
    // Seed an intra-day anchor: flight lands at 14:00 local, switches to DEST_ZONE.
    await seedTimezoneAnchor(sub, {
      effective_date: TRAVEL_DATE,
      effective_time: '14:00',
      zone: DEST_ZONE,
    });

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TRAVEL_DATE);

    // Wait for schedule list to load (not just skeleton).
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 5_000 });

    // The switch row should be the first element inside the schedule list.
    const switchRow = page.locator('app-timezone-switch-row');
    await expect(switchRow).toBeVisible({ timeout: 3_000 });
    await expect(switchRow).toContainText('Switch to');
  });

  // ── Downstream divergent day: chip/banner visible ──────────────────────────

  test('downstream day shows divergent timezone banner when anchor is in effect', async ({ page }) => {
    // Whole-day anchor on travel date → governs all downstream days.
    await seedTimezoneAnchor(sub, {
      effective_date: TRAVEL_DATE,
      effective_time: undefined,  // whole-day
      zone: DEST_ZONE,
    });

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(DOWNSTREAM_DATE);

    // Wait for the schedule to settle.
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 5_000 });

    // The day header should show the divergent timezone banner (chip + subtext).
    const banner = page.locator('.tz-banner');
    await expect(banner).toBeVisible({ timeout: 3_000 });
    // The chip should contain city text from the destination zone (zone-format
    // uppercases IANA city names, so match case-insensitively).
    await expect(banner).toContainText(/honolulu/i);
  });

  // ── Correction flow: "Use my current zone" removes surfacing ──────────────

  test('"Use my current zone" on travel-day why-popover removes the switch row', async ({ page }) => {
    // Seed an intra-day anchor with an inference_group so the group-delete path is taken.
    const inferenceGroup = '00000000-1111-2222-3333-444444444444';
    await seedTimezoneAnchor(sub, {
      effective_date: TRAVEL_DATE,
      effective_time: '14:00',
      zone: DEST_ZONE,
      inference_group: inferenceGroup,
    });

    const dayView = new DayViewPage(page);
    await dayView.gotoDate(TRAVEL_DATE);

    // Confirm the switch row is present before the correction.
    await expect(dayView.getScheduleList()).toBeVisible({ timeout: 5_000 });
    const switchRow = page.locator('app-timezone-switch-row');
    await expect(switchRow).toBeVisible({ timeout: 3_000 });

    // Open the why-popover via the "(why?)" button on the switch row.
    const whyBtn = switchRow.getByRole('button', { name: /why/i });
    await whyBtn.click();

    // The why-popover should appear.
    const whyPop = page.locator('app-timezone-why');
    await expect(whyPop).toBeVisible({ timeout: 2_000 });

    // Click "Use my current zone".
    await whyPop.getByRole('button', { name: /Use my current zone/i }).click();

    // After the correction the popover should close and the switch row should
    // disappear (the anchor group was deleted).
    await expect(whyPop).not.toBeVisible({ timeout: 5_000 });
    await expect(switchRow).not.toBeVisible({ timeout: 5_000 });

    // Backend verification: the anchor group should be gone.
    const remaining = await listTimezoneAnchors(sub, TRAVEL_DATE);
    const groupAnchors = remaining.filter(a => a.inference_group === inferenceGroup);
    expect(groupAnchors).toHaveLength(0);
  });

});
