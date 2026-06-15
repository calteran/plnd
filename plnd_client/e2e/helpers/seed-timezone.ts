// Timezone anchor seeding helpers for e2e tests.
//
// Mirrors the pattern in seed-data.ts: each helper authenticates with the
// per-test sub and drives the real backend through public API endpoints.
// The `/timezone/anchors` endpoint is `user`-source only (source forced by
// the backend regardless of what we pass).

import { API_BASE, mintTestToken } from './auth';
import { TimezoneAnchorDto } from '../../src/app/core/models/timezone';

export interface TimezoneAnchorInput {
  /** YYYY-MM-DD */
  effective_date: string;
  /** 'HH:MM' — omit for whole-day anchors */
  effective_time?: string;
  /** IANA zone, e.g. 'Pacific/Honolulu' */
  zone: string;
  /** Optional inference_group UUID (for batched deletion) */
  inference_group?: string;
}

/**
 * Seeds one timezone anchor for the authenticated test user via
 * `POST /timezone/anchors`. Returns the full response DTO so callers can
 * extract the assigned `id` or `inference_group`.
 */
export async function seedTimezoneAnchor(
  sub: string,
  anchor: TimezoneAnchorInput,
): Promise<TimezoneAnchorDto> {
  const token = await mintTestToken(sub);
  const res = await fetch(`${API_BASE}/timezone/anchors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(anchor),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(
      `seedTimezoneAnchor: POST /timezone/anchors returned ${res.status}. Body: ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as TimezoneAnchorDto;
}

/**
 * Deletes all timezone anchors for a user via
 * `DELETE /timezone/anchors/group/{group}`. Used by correction-flow assertions
 * to confirm the UI's "Use my current zone" call did the right thing.
 */
export async function deleteTimezoneGroup(sub: string, group: string): Promise<void> {
  const token = await mintTestToken(sub);
  const res = await fetch(`${API_BASE}/timezone/anchors/group/${group}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(
      `deleteTimezoneGroup: DELETE /timezone/anchors/group/${group} returned ${res.status}. Body: ${text.slice(0, 200)}`,
    );
  }
}

/**
 * Lists all timezone anchors up to `through` date for a user.
 * Used by assertions to verify that an anchor was created or removed.
 */
export async function listTimezoneAnchors(
  sub: string,
  through: string,
): Promise<TimezoneAnchorDto[]> {
  const token = await mintTestToken(sub);
  const res = await fetch(`${API_BASE}/timezone/anchors?through=${through}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(
      `listTimezoneAnchors: GET /timezone/anchors?through=${through} returned ${res.status}. Body: ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as TimezoneAnchorDto[];
}
