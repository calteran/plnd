import { test, expect } from '../fixtures';
import { seedAuth } from '../helpers/auth';
import { grantGeolocation, mockBriefingProviders } from '../helpers/briefing-mocks';
import { DayViewPage } from '../pages/day-view.page';

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

test('day-view briefing shows the resolved city alongside the weather', async ({ page, context }) => {
  // Geolocation + third-party mocks must be in place before the app fetches.
  await grantGeolocation(context);
  await mockBriefingProviders(page);

  // seedAuth completes onboarding so the /day route guard lets us through.
  await seedAuth(page);

  const dayView = new DayViewPage(page);
  await dayView.gotoDate(isoToday());
  await expect(dayView.getScheduleList()).toBeVisible();

  await expect(page.locator('.weather-city')).toHaveText('Portland');
  await expect(page.locator('.weather-temp')).toContainText('14');
});
