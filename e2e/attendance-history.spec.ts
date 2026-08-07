import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { businessToday } from './setup/business-date.js';
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

    // 打刻はこの画面の外で起き、保存へ届くのは表示が変わるより後になり得る。
    // 届くまで読み直す。届かなければ、ここで落ちる。
    // 業務日は拠点の時間帯で決まる。UTC の日付では、UTC で 15 時を過ぎると 1 日ずれる。
    const today = businessToday();
    const row = history(page).locator('.history-list > li', { hasText: today });
    await expect(async () => {
      await history(page).getByRole('button', { name: '読み直す' }).click();
      await expect(row).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30000 });

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
