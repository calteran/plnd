# Timezone Surfacing (Parts B+C+D of #931) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make divergent-zone days legible in day-view (D5), report the device zone on app load (D3/D9 client half), and silently seed the first anchor during onboarding (D6) — building on the Part A wall-clock contract and date-only helper.

**Architecture:** Part B+C+D of #931 (master #928). Stacked on the Part A branch (`worktree-feat-931-client-tz-surfacing`, PR #938) — this branch's PR targets that branch until #938 merges, then rebases onto main. Backend timezone endpoints already exist (#929/#930): `GET /timezone/anchors?through=`, `GET /timezone/resolve?at=&time=`, `POST /timezone/anchors`, `DELETE /timezone/anchors/{id}`, `DELETE /timezone/anchors/group/{group}`, `POST /timezone/device`, `POST /timezone/standoff/dismiss`. This PR is **client-only** — no Rust changes.

**Tech Stack:** Angular 21 (standalone, signals, `inject()`). Zone names via `Intl.DateTimeFormat` generic names (no new dependency). Client tests: `npx ng test` from this worktree's `plnd_client/`. Gate: `just verify`.

**Key design facts (from `docs/superpowers/specs/2026-06-15-timezone-handling-design.md`):**
- A timezone-change anchor's zone applies to everything ordered at/after it until the next anchor (positional rule, D2). Day-view computes zones **locally** from the anchor list (one `GET /timezone/anchors?through=<date>` per viewed day) rather than multiple `/resolve` round-trips.
- "Current zone" = zone in effect at *now* (most recent anchor at-or-before the present; normally device-sourced).
- Same-zone day → render nothing. Full-divergent day → chip + subtext + `(why?)`. Travel day (intra-day anchor) → `TRAVEL DAY` pill (no subtitle) + inline switch row + `(why?)` on the row.
- The displayed item time is the literal wall-clock (Part A); zone projection sets *context/labels*, it does not convert HH:MM.

---

## File Structure

**Part B (device report + standoff):**
- Create: `plnd_client/src/app/core/models/timezone.ts` — DTOs (anchor, resolve, device-affirm, standoff).
- Create: `plnd_client/src/app/core/services/timezone.service.ts` (+ `.spec.ts`) — endpoint wrapper + `deviceZone()`.
- Create: `plnd_client/src/app/features/day-view/components/timezone-standoff/timezone-standoff.ts` (+ `.spec.ts`) — the one-time gentle confirm.
- Modify: `plnd_client/src/app/layouts/main-layout/main-layout.ts` — fire device-affirm on load (authenticated), host the standoff confirm.

**Part C (onboarding seed):**
- Modify: `plnd_client/src/app/features/onboarding/account/onboarding-account.ts` — seed first device anchor.

**Part D (day-view surfacing):**
- Create: `plnd_client/src/app/core/utils/zone-format.ts` (+ `.spec.ts`) — Intl-based city/short/long names + offset phrasing.
- Create: `plnd_client/src/app/core/utils/zone-projection.ts` (+ `.spec.ts`) — pure day classification + per-item zone walk.
- Create: `plnd_client/src/app/features/day-view/components/timezone-switch-row/timezone-switch-row.ts` (+ `.spec.ts`) — inline travel-day row.
- Create: `plnd_client/src/app/features/day-view/components/timezone-why/timezone-why.ts` (+ `.spec.ts`) — `(why?)` provenance + actions.
- Modify: `plnd_client/src/app/features/schedule/components/day-header/day-header.ts` — chip/subtext/pill + `(why?)` host.
- Modify: `plnd_client/src/app/features/day-view/day-view.ts` — fetch anchors, build the projection VM, splice the switch row.
- Create e2e: `plnd_client/e2e/tests/timezone.e2e.ts` — seeded future-trip scenario.

---

## Task B1: TimezoneService + DTOs

**Files:** Create `core/models/timezone.ts`, `core/services/timezone.service.ts`, `core/services/timezone.service.spec.ts`.

- [ ] **Step 1: DTOs** — `core/models/timezone.ts`:

```ts
// Wire DTOs for the timezone endpoints (#929/#930). zone is an IANA name.
export type TimezoneSource = 'device' | 'user' | 'inferred';

export interface TimezoneAnchorDto {
  id: string;
  user_id: string;
  effective_date: string;          // YYYY-MM-DD
  effective_time: string | null;   // "HH:MM:SS" or null (whole-day)
  zone: string;                    // IANA, e.g. "America/Denver"
  source: TimezoneSource;
  source_ref: string | null;
  inference_group: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolveResponse { zone: string | null; }

export type DeviceAffirmOutcome = 'no_change' | 'appended' | 'recording' | 'standoff';

export interface StandoffConfirm { intended_zone: string; device_zone: string; }

export interface DeviceAffirmResponse {
  outcome: DeviceAffirmOutcome;
  effective_zone: string | null;
  confirm: StandoffConfirm | null;
}

export interface CreateAnchorRequest {
  effective_date: string;           // YYYY-MM-DD
  effective_time?: string | null;   // "HH:MM" optional
  zone: string;                     // IANA
  source_ref?: string | null;
  inference_group?: string | null;
}
```

- [ ] **Step 2: Failing service spec** — `timezone.service.spec.ts` (use provider APIs, never `HttpClientTestingModule`):

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TimezoneService } from './timezone.service';
import { ConfigService } from './config.service';

describe('TimezoneService', () => {
  let service: TimezoneService;
  let httpMock: HttpTestingController;
  const apiBase = 'http://api.test';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), TimezoneService,
        { provide: ConfigService, useValue: { getConfig: () => ({ api: { baseUrl: apiBase } }) } },
      ],
    });
    service = TestBed.inject(TimezoneService);
    httpMock = TestBed.inject(HttpTestingController);
  });
  afterEach(() => httpMock.verify());

  it('reportDeviceZone POSTs the device IANA zone', () => {
    let res: unknown;
    service.reportDeviceZone('America/Denver').subscribe(r => (res = r));
    const req = httpMock.expectOne(`${apiBase}/timezone/device`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ zone: 'America/Denver' });
    req.flush({ outcome: 'no_change', effective_zone: 'America/Denver', confirm: null });
    expect(res).toEqual({ outcome: 'no_change', effective_zone: 'America/Denver', confirm: null });
  });

  it('listAnchors GETs anchors through a date', () => {
    service.listAnchors('2026-07-01').subscribe();
    const req = httpMock.expectOne(`${apiBase}/timezone/anchors?through=2026-07-01`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('deleteGroup DELETEs the inference group', () => {
    service.deleteGroup('grp-1').subscribe();
    const req = httpMock.expectOne(`${apiBase}/timezone/anchors/group/grp-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ deleted: 2 });
  });

  it('dismissStandoff POSTs to the dismiss endpoint', () => {
    service.dismissStandoff().subscribe();
    const req = httpMock.expectOne(`${apiBase}/timezone/standoff/dismiss`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });

  it('deviceZone returns the Intl resolved IANA zone', () => {
    expect(service.deviceZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
```

- [ ] **Step 3: Implement** — `timezone.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ConfigService } from './config.service';
import {
  TimezoneAnchorDto, ResolveResponse, DeviceAffirmResponse, CreateAnchorRequest,
} from '../models/timezone';

@Injectable({ providedIn: 'root' })
export class TimezoneService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;

  /** The device's current IANA zone, e.g. "America/Denver". */
  deviceZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  reportDeviceZone(zone: string): Observable<DeviceAffirmResponse> {
    return this.http.post<DeviceAffirmResponse>(`${this.apiBase}/timezone/device`, { zone });
  }

  resolve(at: string, time?: string): Observable<ResolveResponse> {
    const q = time ? `?at=${at}&time=${time}` : `?at=${at}`;
    return this.http.get<ResolveResponse>(`${this.apiBase}/timezone/resolve${q}`);
  }

  listAnchors(through: string): Observable<TimezoneAnchorDto[]> {
    return this.http.get<TimezoneAnchorDto[]>(`${this.apiBase}/timezone/anchors?through=${through}`);
  }

  createAnchor(body: CreateAnchorRequest): Observable<TimezoneAnchorDto> {
    return this.http.post<TimezoneAnchorDto>(`${this.apiBase}/timezone/anchors`, body);
  }

  deleteAnchor(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiBase}/timezone/anchors/${id}`);
  }

  deleteGroup(group: string): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${this.apiBase}/timezone/anchors/group/${group}`);
  }

  dismissStandoff(): Observable<void> {
    return this.http.post<void>(`${this.apiBase}/timezone/standoff/dismiss`, {});
  }
}
```

- [ ] **Step 4: Run** `npx ng test --include='**/timezone.service.spec.ts' --watch=false` (from `plnd_client/`). Expected PASS.
- [ ] **Step 5: Commit** `feat(timezone): client TimezoneService + DTOs (#931)`.

---

## Task B2: App-load device-affirm + standoff confirm

**Files:** Create `features/day-view/components/timezone-standoff/timezone-standoff.ts` (+spec). Modify `layouts/main-layout/main-layout.ts`.

**Scene:** On app load, when authenticated, report the device zone. If the backend returns `outcome: 'standoff'`, render the **one-time gentle confirm** (the only prompt the timezone feature raises). `main-layout` is the authed app shell (it imports `todayIso`/`offsetIso` per earlier grep, so it already hosts logged-in chrome).

- [ ] **Step 1: Standoff component** — `timezone-standoff.ts`. A quiet inline banner. Copy uses the *friendly* zone name of `intended_zone` (via `zoneLong` from Task D1 — if D1 not yet done, inline a minimal `Intl … longGeneric` call and replace with `zoneLong` in D1). Template:

```ts
import { Component, input, output } from '@angular/core';
import { zoneLong } from '../../../../core/utils/zone-format';

@Component({
  selector: 'app-timezone-standoff',
  standalone: true,
  template: `
    <div class="tz-standoff" role="status">
      <span class="tz-standoff__msg">
        Back in {{ intendedLabel() }}, or is your device clock off?
      </span>
      <div class="tz-standoff__actions">
        <button type="button" class="tz-standoff__btn" (click)="moved.emit()">I moved here</button>
        <button type="button" class="tz-standoff__btn tz-standoff__btn--ghost" (click)="clockOff.emit()">Clock's off</button>
      </div>
    </div>
  `,
  styleUrl: './timezone-standoff.scss',
})
export class TimezoneStandoffComponent {
  readonly intendedZone = input.required<string>(); // IANA
  readonly deviceZone   = input.required<string>(); // IANA
  readonly moved    = output<void>(); // user moved → create user anchor at deviceZone
  readonly clockOff = output<void>(); // device wrong → dismiss standoff
  protected intendedLabel = () => zoneLong(this.intendedZone(), new Date());
}
```
Add a minimal `.scss` (compact banner, theme tokens consistent with existing toast styles in `day-view.scss`). Spec: assert the message contains "Back in" + the friendly intended zone, and that the two buttons emit `moved`/`clockOff`.

- [ ] **Step 2: Wire into main-layout** — inject `AuthService`, `TimezoneService`, `TodayIso`. In `ngOnInit` (or constructor effect), if `auth.isAuthenticated()`, call `tz.reportDeviceZone(tz.deviceZone())`; hold a `standoff = signal<StandoffConfirm | null>(null)`; on response with `outcome==='standoff'` set it. Render `@if (standoff(); as s) { <app-timezone-standoff [intendedZone]="s.intended_zone" [deviceZone]="s.device_zone" (moved)="onMoved(s)" (clockOff)="onClockOff()" /> }`.
  - `onMoved(s)`: `tz.createAnchor({ effective_date: todayIso(), zone: s.device_zone })` then `standoff.set(null)`.
  - `onClockOff()`: `tz.dismissStandoff()` then `standoff.set(null)`.
  Subscribe with `takeUntilDestroyed`. Errors: swallow (fire-and-forget; never block the shell).

- [ ] **Step 3:** spec for main-layout's device-affirm trigger (authenticated → POST fired; standoff response → component shown). Use `provideHttpClientTesting` + a stub `AuthService` with `isAuthenticated: () => true`.
- [ ] **Step 4:** `npx ng test --include='**/timezone-standoff.spec.ts' --include='**/main-layout.spec.ts' --watch=false`. PASS.
- [ ] **Step 5: Commit** `feat(timezone): report device zone on load + one-time standoff confirm (#931)`.

---

## Task C1: Onboarding device-zone seed (D6)

**Files:** Modify `features/onboarding/account/onboarding-account.ts`.

**Scene:** Onboarding must silently seed the first timezone-change anchor from the device zone — no picker. The device-affirm endpoint appends a `device` anchor when none exists yet (zero anchors → `decide_device_affirm` returns Append), so seeding = one `reportDeviceZone()` call. The account step is the first onboarding spoke and always runs.

- [ ] **Step 1:** Inject `TimezoneService`. When the account step completes its save (find the existing "mark account complete"/save success path), fire `tz.reportDeviceZone(tz.deviceZone())` once, fire-and-forget (`takeUntilDestroyed`, swallow errors). Add a guard signal/flag so it isn't re-sent if the step re-renders.
- [ ] **Step 2:** spec — on account-complete, a POST to `/timezone/device` with the Intl zone is fired. Reuse the file's existing test harness; add `provideHttpClientTesting` if not present.
- [ ] **Step 3:** `npx ng test --include='**/onboarding-account.spec.ts' --watch=false`. PASS.
- [ ] **Step 4: Commit** `feat(timezone): seed first device anchor during onboarding (#931)`.

---

## Task D1: zone-format util (Intl generic names + offset phrasing)

**Files:** Create `core/utils/zone-format.ts` (+spec).

**Why Intl generic names:** `Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortGeneric' })` yields "MT"/"ET"/"PT" for US zones (and "<Region> Time" for others); `'longGeneric'` yields "Mountain Time". City is the IANA path's last segment. Offsets come from comparing the two zones' UTC offset on a given date.

- [ ] **Step 1: Failing spec** — `zone-format.spec.ts`:

```ts
import { zoneCity, zoneShort, zoneLong, offsetPhrase, offsetWords } from './zone-format';

describe('zone-format', () => {
  const d = new Date(Date.UTC(2026, 6, 15, 12, 0, 0)); // mid-July (summer)

  it('zoneCity derives an uppercase city from the IANA path', () => {
    expect(zoneCity('America/Denver')).toBe('DENVER');
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('BUENOS AIRES');
  });

  it('zoneShort/zoneLong use Intl generic names for US zones', () => {
    expect(zoneShort('America/Denver', d)).toBe('MT');
    expect(zoneLong('America/Denver', d)).toBe('Mountain Time');
    expect(zoneShort('America/New_York', d)).toBe('ET');
  });

  it('offsetPhrase describes the day zone relative to the current zone', () => {
    // Denver (MDT, -6) is 2h behind New York (EDT, -4) in summer.
    expect(offsetPhrase('America/Denver', 'America/New_York', d)).toBe('2h behind your current zone');
    expect(offsetPhrase('America/New_York', 'America/Denver', d)).toBe('2h ahead of your current zone');
    expect(offsetPhrase('America/Denver', 'America/Denver', d)).toBe('same as your current zone');
  });

  it('offsetWords phrases a switch from one zone to another', () => {
    // Denver (-6) → Honolulu (-10) is 4 hours earlier.
    expect(offsetWords('America/Denver', 'Pacific/Honolulu', d)).toBe('4 hours earlier');
    expect(offsetWords('Pacific/Honolulu', 'America/Denver', d)).toBe('4 hours later');
  });
});
```

- [ ] **Step 2: Implement** — `zone-format.ts`:

```ts
// IANA timezone → display strings, via Intl CLDR generic names (no dependency).

function tzNamePart(zone: string, date: Date, kind: 'shortGeneric' | 'longGeneric'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: kind })
    .formatToParts(date);
  return parts.find(p => p.type === 'timeZoneName')?.value ?? zone;
}

/** "America/Denver" → "DENVER" (last path segment, underscores→spaces, uppercased). */
export function zoneCity(zone: string): string {
  return zone.split('/').pop()!.replace(/_/g, ' ').toUpperCase();
}

/** Short generic zone label, e.g. "MT". Falls back to a "<Region> Time" Intl string for non-US zones. */
export function zoneShort(zone: string, date: Date): string {
  return tzNamePart(zone, date, 'shortGeneric');
}

/** Long generic zone label, e.g. "Mountain Time". */
export function zoneLong(zone: string, date: Date): string {
  return tzNamePart(zone, date, 'longGeneric');
}

/** UTC offset of `zone` at `date`, in whole minutes (e.g. America/Denver summer → -360). */
function offsetMinutes(zone: string, date: Date): number {
  // Format the same instant in the target zone, read back the wall-clock, diff from UTC.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p['year'], +p['month'] - 1, +p['day'], +(p['hour'] === '24' ? '0' : p['hour']), +p['minute'], +p['second']);
  return Math.round((asUTC - date.getTime()) / 60000);
}

function diffHours(a: string, b: string, date: Date): number {
  return Math.round((offsetMinutes(a, date) - offsetMinutes(b, date)) / 60);
}

/** "2h behind your current zone" / "ahead of" / "same as", dayZone vs currentZone. */
export function offsetPhrase(dayZone: string, currentZone: string, date: Date): string {
  const h = diffHours(dayZone, currentZone, date);
  if (h === 0) return 'same as your current zone';
  return h < 0 ? `${-h}h behind your current zone` : `${h}h ahead of your current zone`;
}

/** "5 hours earlier" / "5 hours later" for a switch fromZone → toZone. */
export function offsetWords(fromZone: string, toZone: string, date: Date): string {
  const h = diffHours(toZone, fromZone, date);
  const n = Math.abs(h);
  const unit = n === 1 ? 'hour' : 'hours';
  if (h === 0) return 'same time';
  return h < 0 ? `${n} ${unit} earlier` : `${n} ${unit} later`;
}
```

- [ ] **Step 3: Run** `npx ng test --include='**/zone-format.spec.ts' --watch=false`. PASS. (If a label assertion differs by ICU version, prefer the actual Intl output and adjust the expectation — note any deviation.)
- [ ] **Step 4: Commit** `feat(timezone): zone-format util via Intl generic names (#931)`.

---

## Task D2: zone projection (pure logic) + day-view fetch

**Files:** Create `core/utils/zone-projection.ts` (+spec).

**Model:** Mirror the backend positional rule client-side so day-view needs one `listAnchors(through=date)` fetch. The whole-day "incoming" zone = zone of the most recent anchor at/before the day with **no** intra-day position; intra-day anchors (those with `effective_date === date`, ordered by `effective_time` NULLS-first) split the day.

- [ ] **Step 1: Failing spec** — `zone-projection.spec.ts`. Define `classifyDay(anchors, date, currentZone)` → a `DayZoneView`:

```ts
import { classifyDay, DayZoneView } from './zone-projection';
import { TimezoneAnchorDto } from '../models/timezone';

function anchor(date: string, zone: string, time: string | null = null, extra: Partial<TimezoneAnchorDto> = {}): TimezoneAnchorDto {
  return { id: `${date}-${zone}`, user_id: 'u', effective_date: date, effective_time: time, zone,
           source: 'user', source_ref: null, inference_group: null, created_at: '', updated_at: '', ...extra };
}

describe('classifyDay', () => {
  it('same-zone day → kind "same"', () => {
    const v = classifyDay([anchor('2026-01-01', 'America/New_York')], '2026-07-10', 'America/New_York');
    expect(v.kind).toBe('same');
  });

  it('full divergent day → kind "divergent" with incoming zone', () => {
    const anchors = [anchor('2026-01-01', 'America/New_York'), anchor('2026-07-01', 'America/Denver')];
    const v = classifyDay(anchors, '2026-07-10', 'America/New_York');
    expect(v.kind).toBe('divergent');
    expect(v.incomingZone).toBe('America/Denver');
  });

  it('travel day (intra-day anchor) → kind "travel" with switch zones', () => {
    const anchors = [anchor('2026-01-01', 'America/Denver'), anchor('2026-07-10', 'Pacific/Honolulu', '14:00:00')];
    const v = classifyDay(anchors, '2026-07-10', 'America/Denver');
    expect(v.kind).toBe('travel');
    expect(v.switch?.fromZone).toBe('America/Denver');
    expect(v.switch?.toZone).toBe('Pacific/Honolulu');
  });
});
```

- [ ] **Step 2: Implement** — `zone-projection.ts`:

```ts
import { TimezoneAnchorDto } from '../models/timezone';

export interface DaySwitch { fromZone: string; toZone: string; anchor: TimezoneAnchorDto; }
export interface DayZoneView {
  kind: 'same' | 'divergent' | 'travel';
  incomingZone: string | null;   // zone at the start of the day
  currentZone: string;           // zone in effect now
  switch?: DaySwitch;            // present iff kind === 'travel' (first intra-day switch)
}

/** Anchors sorted by (effective_date, effective_time NULLS FIRST) — mirrors the backend order. */
function ordered(anchors: TimezoneAnchorDto[]): TimezoneAnchorDto[] {
  return [...anchors].sort((a, b) =>
    a.effective_date !== b.effective_date
      ? a.effective_date.localeCompare(b.effective_date)
      : (a.effective_time ?? '').localeCompare(b.effective_time ?? ''));
}

/** Zone at the START of `date`: most recent anchor strictly before `date`, plus any
 *  whole-day (effective_time === null) anchor on `date` itself. */
function incomingZoneAt(anchors: TimezoneAnchorDto[], date: string): string | null {
  let zone: string | null = null;
  for (const a of ordered(anchors)) {
    if (a.effective_date < date) zone = a.zone;
    else if (a.effective_date === date && a.effective_time === null) zone = a.zone;
    else break;
  }
  return zone;
}

export function classifyDay(anchors: TimezoneAnchorDto[], date: string, currentZone: string): DayZoneView {
  const incomingZone = incomingZoneAt(anchors, date);
  const intraday = ordered(anchors).filter(a => a.effective_date === date && a.effective_time !== null);

  if (intraday.length > 0) {
    const first = intraday[0];
    const fromZone = incomingZone ?? currentZone;
    return { kind: 'travel', incomingZone, currentZone, switch: { fromZone, toZone: first.zone, anchor: first } };
  }
  const effective = incomingZone ?? currentZone;
  return { kind: effective === currentZone ? 'same' : 'divergent', incomingZone, currentZone };
}
```

- [ ] **Step 3:** `npx ng test --include='**/zone-projection.spec.ts' --watch=false`. PASS.
- [ ] **Step 4: Commit** `feat(timezone): pure day-zone projection (#931)`.

---

## Task D3: header chip / subtext / TRAVEL DAY pill + (why?) host

**Files:** Modify `features/schedule/components/day-header/day-header.ts` (+ its `.spec.ts`, `.scss`).

- [ ] **Step 1:** Add an optional input `readonly zoneView = input<DayZoneView | null>(null);` and an output `readonly whyClicked = output<void>();`. In the template, under the date row, render conditionally:
  - `divergent`: a chip `{{ chip() }}` (= `zoneCity(incomingZone) + ' · ' + zoneShort(incomingZone, date)`), subtext `{{ subtext() }}` (= `zoneLong(incomingZone,date) + ' · ' + offsetPhrase(incomingZone, currentZone, date)`), and a `(why?)` button emitting `whyClicked`.
  - `travel`: a `TRAVEL DAY` pill, **no subtitle**, **no header (why?)** (the why lives on the inline row in D4/D5).
  - `same`/null: render nothing new.
  Compute `chip()`/`subtext()` via `zone-format` helpers, guarding null `incomingZone`. Parse the date via `parseDateOnly(this.date())` for the offset calc.
- [ ] **Step 2:** spec — divergent view renders chip "DENVER · MT" + subtext containing "Mountain Time" and "2h behind your current zone" + a `(why?)` that emits `whyClicked`; travel view renders "TRAVEL DAY" and no subtitle; same/null renders neither.
- [ ] **Step 3:** `npx ng test --include='**/day-header.spec.ts' --watch=false`. PASS.
- [ ] **Step 4: Commit** `feat(timezone): day-header zone chip/subtext/travel pill (#931)`.

---

## Task D4: inline travel-day switch row

**Files:** Create `features/day-view/components/timezone-switch-row/timezone-switch-row.ts` (+spec, +scss).

- [ ] **Step 1:** Component input `readonly switch = input.required<DaySwitch>();`, `readonly date = input.required<string>();`, output `whyClicked = output<void>()`. Template renders a list row:
  `✈ Switch to {{ toLabel() }} ({{ words() }}) (why?)` where `toLabel() = zoneLong(switch().toZone, parseDateOnly(date()))` and `words() = offsetWords(switch().fromZone, switch().toZone, parseDateOnly(date()))` → e.g. "✈ Switch to Hawaii Time (4 hours earlier)". The `(why?)` is a button emitting `whyClicked`. Style as a distinct inline band (not a task/meal row).
- [ ] **Step 2:** spec — renders "Switch to Hawaii Time" + "(4 hours earlier)"; `(why?)` emits.
- [ ] **Step 3:** `npx ng test --include='**/timezone-switch-row.spec.ts' --watch=false`. PASS.
- [ ] **Step 4: Commit** `feat(timezone): inline travel-day switch row (#931)`.

---

## Task D5: (why?) provenance popover + corrections

**Files:** Create `features/day-view/components/timezone-why/timezone-why.ts` (+spec, +scss).

**Provenance copy (exact):** inferred → `Inferred from "<source title>" on <Weekday>`; user → `Set by you on <Mon D>`; device → `From your device`. Actions: **Use my current zone** / **Pick a different zone…**.

- [ ] **Step 1:** Inputs: `anchor = input.required<TimezoneAnchorDto>()`, `currentZone = input.required<string>()`, optional `sourceLabel = input<string | null>(null)` (the originating task title for inferred, when known; else omit the `from "..."` clause). Outputs: `useCurrent = output<void>()`, `pickZone = output<string>()` (emits chosen IANA), `closed = output<void>()`.
  - Provenance line from `anchor().source`: device → "From your device"; user → `Set by you on ${formatMonthDay(anchor().effective_date)}`; inferred → `sourceLabel() ? 'Inferred from "'+sourceLabel()+'" on '+weekday(effective_date) : 'Inferred from your travel plans'`. Use `parseDateOnly` + `toLocaleDateString`.
  - "Use my current zone" → `useCurrent`. "Pick a different zone…" → a minimal `<select>` of common IANA zones (reuse the zone list from `zone-format` or a short curated list) emitting `pickZone`.
- [ ] **Step 2:** spec — device/user/inferred each render the right provenance line; `useCurrent`/`pickZone` emit.
- [ ] **Step 3:** `npx ng test --include='**/timezone-why.spec.ts' --watch=false`. PASS.
- [ ] **Step 4: Commit** `feat(timezone): (why?) provenance popover + corrections (#931)`.

---

## Task D6: day-view integration + e2e

**Files:** Modify `features/day-view/day-view.ts` (+ `day-view.spec.ts`). Create `e2e/tests/timezone.e2e.ts`.

- [ ] **Step 1: Wire the projection.** In `DayViewComponent`: inject `TimezoneService`. On each `loadDay`/route change, `tz.listAnchors(date)` and `tz.resolve(todayIso(), <now HH:MM>)` (or derive current zone from anchors); build `zoneView = signal<DayZoneView|null>(null)` via `classifyDay(anchors, date, currentZone)`. Pass `[zoneView]="zoneView()"` to `<app-day-header>` and handle `(whyClicked)` by opening `<app-timezone-why>` for the governing anchor.
- [ ] **Step 2: Splice the switch row.** When `zoneView()?.kind === 'travel'`, render `<app-timezone-switch-row>` in the schedule list at the switch position. Simplest correct placement for v1: render it as the first row of the list (above timed items) when items lack clock ordering, OR — if items have `scheduledStart` — between items whose time < `switch.anchor.effective_time` and those ≥ it. Use `scheduledStart` HH:MM compare; floating/untimed items render after. Wire `(whyClicked)` to the same `(why?)` popover.
- [ ] **Step 3: Corrections.** `(why?)` actions: `useCurrent` → if the anchor is `inferred` and has an `inference_group`, `tz.deleteGroup(group)`; else `tz.deleteAnchor(anchor.id)`; then reload. `pickZone(z)` → `tz.createAnchor({ effective_date: date, zone: z })` (a superseding `user` anchor) then reload.
- [ ] **Step 4: Unit spec** — day-view builds a divergent view (header gets a zoneView) from a stubbed `listAnchors`; a travel view splices the switch row. Use `provideHttpClientTesting`.
- [ ] **Step 5: e2e** — `e2e/tests/timezone.e2e.ts`, seeding via **real API helpers** (per CLAUDE.md; not `/test/seed`):
  - Seed a user, create a future travel anchor pair via `POST /timezone/anchors` (depart + return, shared `inference_group`) and schedule entries on the travel day + a downstream day in the destination zone.
  - Assert: the travel day shows the inline switch row ("Switch to … "); a downstream full day shows the destination chip + subtext; clicking `(why?)` → "Use my current zone" removes the anchor(s) and the chip disappears on reload.
  - Reuse `e2e/helpers/auth.ts` (`seedAuth`/`mintTestToken`) and any anchor helper; if none exists, add a small helper that POSTs anchors with the minted token.
- [ ] **Step 6: Full gate** — `just fmt` then `just verify`. Expected green (re-run once if auth-infra e2e flakiness appears — see #926).
- [ ] **Step 7: Commit** `feat(timezone): day-view surfacing integration + e2e (#931)`.

---

## Self-Review

- **Spec coverage:** D3 device report (B2) + standoff confirm (B2); D6 onboarding seed (C1); D5 day-view chip/subtext/travel-pill (D3), inline switch row (D4), `(why?)` + corrections (D5), integration + e2e (D6); D9 client half = the standoff confirm (B2). ✓
- **Zone labels:** resolved via Intl generic names (user-confirmed: platform/CLDR is the "library"); no new dependency. ✓
- **Local resolution:** day-view computes zones from one `listAnchors` call via the positional rule, mirroring backend `zone_at`. ✓
- **Type consistency:** `DayZoneView`/`DaySwitch`/`TimezoneAnchorDto` names consistent across D2→D3→D4→D6. `zoneShort`/`zoneLong`/`zoneCity`/`offsetPhrase`/`offsetWords` consistent D1→D3→D4. ✓
- **Stacked-PR note:** client-only; PR base = Part A branch until #938 merges. ✓
- **Placeholder scan:** none — utils/logic have full code; UI tasks give exact strings, inputs/outputs, and test assertions. The one explicit v1 simplification (switch-row placement heuristic) is called out, not hidden.
