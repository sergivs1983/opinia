import { expect, type Page } from '@playwright/test';
import { loadE2EState, type E2ESeedAccount, type E2ESeedState } from './state';

export function getSeedState(): E2ESeedState {
  return loadE2EState();
}

export async function loginAs(page: Page, account: E2ESeedAccount) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(account.email);
  await page.getByTestId('login-password').fill(account.password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

export async function ensureDashboard(page: Page) {
  await expect(page.getByTestId('inbox-page')).toBeVisible();
}
