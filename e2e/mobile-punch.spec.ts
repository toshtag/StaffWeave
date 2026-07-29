import { devices, expect, test } from '@playwright/test';
import { E2E_MOBILE_EMPLOYEE } from './setup/prepare-database.js';

/** 携帯電話の画面幅で確認する。 */
test.use({ ...devices['Pixel 5'] });

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(E2E_MOBILE_EMPLOYEE.email);
  await page.getByLabel('パスワード').fill(E2E_MOBILE_EMPLOYEE.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

test.describe('スマートフォンからの打刻', () => {
  test('ワンタップで出勤でき、状態が読み上げ対象になる', async ({ page }) => {
    await signIn(page);

    const workState = page.locator('.work-state');
    await expect(workState).toHaveAttribute('aria-live', 'polite');
    await expect(workState).toHaveText('出勤前');

    const clockIn = page.getByRole('button', { name: '出勤', exact: true });
    // 押しやすい大きさであること。
    const box = await clockIn.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await clockIn.click();
    await expect(workState).toHaveText('勤務中');
  });

  test('オフラインでも打刻を受け付け、復帰後に送信する', async ({ page, context }) => {
    await signIn(page);
    await expect(page.locator('.work-state')).toHaveText('勤務中');

    await context.setOffline(true);
    await page.getByRole('button', { name: '休憩開始' }).click();

    // 端末に残った状態が画面へ反映される。
    await expect(page.locator('.work-state')).toHaveText('休憩中');
    await expect(page.locator('.pending-banner')).toContainText('1 件');

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.locator('.pending-banner')).toHaveCount(0);

    // 送信後は保存された打刻として表示される。
    await page.reload();
    await expect(page.locator('.work-state')).toHaveText('休憩中');
    await expect(page.locator('.punch-events li')).toHaveCount(2);
  });

  test('オフラインで溜めた複数の打刻を順番に送る', async ({ page, context }) => {
    await signIn(page);

    await context.setOffline(true);
    await page.getByRole('button', { name: '休憩終了' }).click();
    await page.getByRole('button', { name: '退勤', exact: true }).click();
    await expect(page.locator('.pending-banner')).toContainText('2 件');

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.locator('.pending-banner')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.work-state')).toHaveText('退勤済み');
    await expect(page.locator('.punch-events li')).toHaveCount(4);
  });

  test('本文への移動リンクがキーボードで使える', async ({ page }) => {
    await signIn(page);

    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
  });
});
