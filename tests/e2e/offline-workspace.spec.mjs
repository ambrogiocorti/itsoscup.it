import { test, expect } from '@playwright/test';

test('PWA install is accessible from the same public and management application', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-install-pwa]')).toHaveCount(1);
  await page.locator('[data-install-pwa]').click();
  await expect(page.locator('#itsoscup-install-help')).toBeVisible();
  await expect(page.locator('#itsoscup-install-help')).toContainText('stesso sito ITSOSCup');
  await page.locator('#itsoscup-install-help button').click();

  await page.goto('/admin/');
  await expect(page.locator('[data-install-pwa]')).toHaveCount(1);
  await expect(page.locator('#btn-prepare-offline')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ITSOSCup Key' })).toHaveCount(0);
  await expect(page.locator('.sidebar-link[data-view="matches"]')).toHaveCount(1);
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
