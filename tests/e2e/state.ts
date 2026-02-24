import fs from 'node:fs';
import path from 'node:path';

export type E2ESeedAccount = {
  email: string;
  password: string;
  userId: string;
  orgId: string;
  bizId?: string;
  reviewId?: string;
};

export type E2ESeedState = {
  runId: string;
  onboarding: E2ESeedAccount;
  core: E2ESeedAccount;
};

const STATE_PATH = path.join(process.cwd(), '.e2e', 'state.json');

export function loadE2EState(): E2ESeedState {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(`[e2e] Seed state not found at ${STATE_PATH}. Run "npm run test:e2e" to generate it.`);
  }
  const raw = fs.readFileSync(STATE_PATH, 'utf8');
  return JSON.parse(raw) as E2ESeedState;
}
