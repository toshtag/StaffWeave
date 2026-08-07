import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_HISTORY_EMPLOYEE } from './setup/prepare-database.js';

/**
 * 過去の日次勤怠を、画面から辿れること。
 *
 * これまで通常の画面は当日しか出せず、昨日以前を選ぶ導線がなかった。
 * API には 1 日を読む経路も過去の訂正もあるのに、利用者はそこへ辿り着けない。
 *
 * ここでは、当日の打刻がその月の一覧へ出て、日を選ぶと詳細が開くところまでを見る。
 * 月を移せることも並べて確かめる。
 */

function history(page: Page) {
  return page.locator('section[aria-labelledby="attendance-history-heading"]');
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  const emailField = page.getByLabel('メールアドレス');
  await expect(emailField).toBeVisible();
  await emailField.fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

test.describe('過去の勤怠', () => {
  test('打刻した日が一覧へ出て、選ぶと詳細が開く', async ({ page }) => {
    await signIn(page, E2E_HISTORY_EMPLOYEE.email, E2E_HISTORY_EMPLOYEE.password);

    await page.getByRole('button', { name: '出勤' }).click();
    await expect(page.locator('.work-state')).toContainText('勤務中');

    // 打刻はこの画面の外で起きる。読み直してから見る。
    await history(page).getByRole('button', { name: '読み直す' }).click();

    // 当日は「その月」に含まれるため、一覧へ出る。
    const today = new Date().toISOString().slice(0, 10);
    const row = history(page).locator('.history-list > li', { hasText: today });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: today }).click();
    await expect(history(page).locator('.history-detail')).toContainText(today);
    await expect(history(page).locator('.history-detail')).toContainText('その日の打刻');
  });

  test('月を移せる', async ({ page }) => {
    await signIn(page, E2E_HISTORY_EMPLOYEE.email, E2E_HISTORY_EMPLOYEE.password);

    const shown = history(page).locator('[aria-live="polite"]');
    const current = await shown.textContent();

    await history(page).getByRole('button', { name: '前の月' }).click();
    await expect(shown).not.toHaveText(current ?? '');

    await history(page).getByRole('button', { name: '次の月' }).click();
    await expect(shown).toHaveText(current ?? '');
  });
});
