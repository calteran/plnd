import { execSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import * as path from 'node:path';

const API_HEALTH_URL = `${process.env['API_BASE'] ?? 'http://localhost:3000'}/health`;
const API_READY_TIMEOUT_MS = 5_000;
const API_PROBE_INTERVAL_MS = 500;

async function isReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

// Short retry loop to absorb "API just started, not quite serving yet" cases
// without papering over "API isn't running at all" (the timeout is short).
async function waitForApi(url: string): Promise<boolean> {
  const deadline = Date.now() + API_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isReady(url)) return true;
    await delay(API_PROBE_INTERVAL_MS);
  }
  return false;
}

export default async function globalSetup(): Promise<void> {
  // CI workflow brings up its own mock-oauth-server + plnd_api and waits for
  // them before invoking playwright. Skip infra management here — CI runners
  // don't have doppler/docker-compose set up the way local dev does.
  if (process.env.CI) return;

  // Local runs (standalone `npx playwright test` or `just verify`): bring up
  // the docker-compose services. `doppler run` injects DB_PASSWORD so the
  // postgres container starts; `--wait` blocks until each service's compose
  // healthcheck passes. Idempotent — already-running services are a no-op.
  const repoRoot = path.resolve(__dirname, '..', '..');
  execSync('doppler run -- docker compose up -d --wait db mock-oauth-server', {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  // plnd_api isn't a docker-compose service — verify.sh starts it natively,
  // standalone runs need `just api` or `just dev`. Probe with a short retry to
  // tolerate "API just booted" and fail fast with an actionable message when
  // it really isn't running.
  if (!(await waitForApi(API_HEALTH_URL))) {
    throw new Error(
      `plnd_api is not reachable at ${API_HEALTH_URL} after ${API_READY_TIMEOUT_MS}ms. ` +
        'E2E tests now perform a real OIDC → backend token exchange and need the API running. ' +
        'Run `just api`, `just dev`, or invoke through `just verify`.',
    );
  }
}
