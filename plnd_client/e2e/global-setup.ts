import { execSync } from 'node:child_process';
import * as path from 'node:path';

const API_HEALTH_URL = 'http://localhost:3000/health';

async function isReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  // Both `just verify` and standalone playwright runs converge on the same
  // docker-compose services — `docker compose up -d --wait` is idempotent when
  // they're already healthy, so this is a true no-op in the verify case.
  // `doppler run` injects DB_PASSWORD so the postgres container starts.
  // `--wait` blocks until each service's compose healthcheck passes; no
  // additional probe needed for db or mock-oauth-server.
  const repoRoot = path.resolve(__dirname, '..', '..');
  execSync('doppler run -- docker compose up -d --wait db mock-oauth-server', {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  // plnd_api lifecycle is not managed by playwright — verify.sh starts it,
  // standalone runs need `just api` or `just dev`. Probe and fail fast with
  // an actionable message rather than letting mintTestToken trip on each test.
  if (!(await isReady(API_HEALTH_URL))) {
    throw new Error(
      `plnd_api is not reachable at ${API_HEALTH_URL}. ` +
        'E2E tests now perform a real OIDC → backend token exchange and need the API running. ' +
        'Run `just api`, `just dev`, or invoke through `just verify`.',
    );
  }
}
