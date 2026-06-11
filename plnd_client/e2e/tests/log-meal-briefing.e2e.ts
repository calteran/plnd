import { test, expect } from '@playwright/test';
import { API_BASE, mintTestToken, seedAuth } from '../helpers/auth';
import { seedMealAnchor } from '../helpers/seed-data';
import { DayViewPage } from '../pages/day-view.page';

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test('marking a meal consumed in the day view is reflected in the briefing meals_logged', async ({ page }) => {
  const yesterday = isoDate(-1);

  // seedAuth completes onboarding so the /day route guard lets us through;
  // injectAuthToken alone redirects to the onboarding hub. The briefing reads
  // the server's real yesterday (Utc::now() - 1), so seed on the real date.
  const { sub } = await seedAuth(page);
  await seedMealAnchor(sub, { date: yesterday, name: 'Lunch', preferred_time: '12:00' });

  const dayView = new DayViewPage(page);
  await dayView.gotoDate(yesterday);
  await expect(dayView.getScheduleList()).toBeVisible({ timeout: 2_000 });

  const row = dayView.getMealRows().first();
  await expect(row).toBeVisible();
  const checkbox = dayView.getMealRowDoneCheckbox(row);
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();

  // The briefing snapshot for yesterday should now count the consumed meal.
  const token = await mintTestToken(sub);
  await expect.poll(async () => {
    const res = await fetch(`${API_BASE}/briefing/yesterday`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return -1;
    const body = (await res.json()) as { meals_logged: number };
    return body.meals_logged;
  }).toBeGreaterThanOrEqual(1);
});
