import { test, expect } from '@playwright/test';

test.describe('visual: empty state', () => {
  test('renders the welcome screen consistently', async ({ page }) => {
    await page.goto('/');
    // Wait for the lockup + Verso heading; this is a stable signal that
    // the chrome rendered before we shoot.
    await expect(page.getByRole('heading', { name: 'Verso' })).toBeVisible();
    // Reduce nondeterminism from animations.
    await page.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' });
    await expect(page).toHaveScreenshot('empty-state.png', { fullPage: true });
  });

  test('skip link is exposed for keyboard users', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByText('Skip to canvas');
    await expect(skip).toBeFocused();
  });

  test('topbar exposes labelled controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByLabel(/workspace path/i)).toBeVisible();
    await expect(page.getByLabel(/recent workspaces/i)).toBeVisible();
  });
});
