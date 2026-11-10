import { test, expect } from '@playwright/test';

test('first visit shows one welcome dialog, never again and no persistent install icon', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-install-pwa]')).toHaveCount(0);
  await expect(page.locator('#itsos-welcome')).toBeVisible();
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(1);
  await expect(page.locator('#onboarding-overlay.open')).toHaveCount(0);
  await expect(page.locator('#itsos-push-banner')).toHaveCount(0);
  await page.locator('[data-welcome-continue]').click();
  await expect(page.locator('#itsos-welcome')).toHaveCount(0);
  await expect(page.locator('#itsos-push-banner')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#itsos-welcome')).toHaveCount(0);
  await page.goto('/admin/');
  await expect(page.locator('[data-install-pwa]')).toHaveCount(0);
  await expect(page.locator('#btn-prepare-offline')).toHaveCount(0);
  await expect(page.getByRole('link',{ name:'ITSOSCup Key' })).toHaveCount(0);
  await expect(page.locator('.sidebar-link[data-view="matches"]')).toHaveCount(1);
});

test('first-visit notification opt-out persists, settings remain editable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#itsos-welcome')).toBeVisible();
  await expect(page.locator('[data-welcome-push="all"]')).toBeVisible();
  await expect(page.locator('[data-welcome-push="limited"]')).toBeVisible();
  await page.locator('[data-welcome-push="none"]').click();
  await expect(page.locator('[data-welcome-push="none"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-welcome-continue]').click();
  await page.reload();
  await expect(page.locator('#itsos-welcome')).toHaveCount(0);
  await expect(page.locator('#itsos-push-banner')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('itsoscup_push_choice_v1'))).toBe('none');
  await page.locator('#public-notifications-btn').click();
  await page.locator('[data-open-push-preferences]').click();
  await expect(page.locator('#itsos-push-banner')).toBeVisible();
  await expect(page.locator('[data-push-mode="none"]')).toBeVisible();
});

test('PWA needs Internet for live and management pages and does not show stale offline shell', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { registerOfflineSupport } = await import('/js/offline.js');
    registerOfflineSupport();
  });
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, { timeout: 15000 });
  await context.setOffline(true);
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'Connessione Internet necessaria' })).toBeVisible();
  await expect(page.locator('#view-matches')).toHaveCount(0);
  await context.setOffline(false);
});
