import { BrowserContext, Page } from '@playwright/test';

/** Deterministic Open-Meteo forecast (code 61 → "Rainy", 14°, 17/11). */
export const MOCK_OPEN_METEO = {
  current: { temperature_2m: 14, precipitation: 0, weather_code: 61 },
  daily: { temperature_2m_max: [17], temperature_2m_min: [11] },
};

/** Deterministic BigDataCloud reverse-geocode result. */
export const MOCK_BIGDATACLOUD = {
  city: 'Portland',
  locality: 'Portland',
  principalSubdivision: 'Oregon',
  countryName: 'United States',
};

/** Intercept the two third-party briefing lookups so e2e never hits the network.
 *  Both are genuinely-external services, so mocking them is allowed by the e2e
 *  policy (docs/architecture.md §9.7). */
export async function mockBriefingProviders(page: Page): Promise<void> {
  await page.route('**/api.open-meteo.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_OPEN_METEO) }),
  );
  await page.route('**/api.bigdatacloud.net/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BIGDATACLOUD) }),
  );
}

/** Grant a fixed geolocation so the briefing service resolves a position. */
export async function grantGeolocation(
  context: BrowserContext,
  coords: { latitude: number; longitude: number } = { latitude: 45.52, longitude: -122.68 },
): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(coords);
}
