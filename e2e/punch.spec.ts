import { expect, test } from '@playwright/test';
import { E2E_EMPLOYEE } from './setup/prepare-database.js';

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(E2E_EMPLOYEE.email);
  await page.getByLabel('パスワード').fill(E2E_EMPLOYEE.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  // 表示言語は利用者設定に従うため、言語に依存しない要素で完了を待つ。
  await expect(page.locator('.work-state')).toBeVisible();
}

/** 表示言語の切り替えは利用者設定として保存されるため、保存が終わるまで待つ。 */
async function selectLocale(
  page: import('@playwright/test').Page,
  locale: 'ja-JP' | 'en',
): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/preferences') && response.request().method() === 'PATCH',
  );
  await page.locator('.locale-switcher select').selectOption(locale);
  await saved;
}

test.describe('従業員の打刻', () => {
  test('ログインして出勤と退勤を打刻できる', async ({ page }) => {
    await signIn(page);

    await expect(page.locator('.work-state')).toHaveText('出勤前');
    await expect(page.getByText('まだ打刻はありません')).toBeVisible();

    await page.getByRole('button', { name: '出勤', exact: true }).click();
    await expect(page.locator('.work-state')).toHaveText('勤務中');

    await page.getByRole('button', { name: '休憩開始' }).click();
    await expect(page.locator('.work-state')).toHaveText('休憩中');

    await page.getByRole('button', { name: '休憩終了' }).click();
    await expect(page.locator('.work-state')).toHaveText('勤務中');

    await page.getByRole('button', { name: '退勤', exact: true }).click();
    await expect(page.locator('.work-state')).toHaveText('退勤済み');

    // 退勤後は押せるボタンが出ない。
    await expect(page.locator('.punch-button')).toHaveCount(0);
    await expect(page.locator('.break-button')).toHaveCount(0);
    await expect(page.locator('.punch-events li')).toHaveCount(4);
    await expect(page.locator('.break-list li')).toHaveCount(1);
  });

  test('再読み込みしても打刻の状態が残る', async ({ page }) => {
    await signIn(page);
    await expect(page.locator('.work-state')).toHaveText('退勤済み');
  });

  test('打刻を修正すると有効な記録が置き換わり、履歴に残る', async ({ page }) => {
    await signIn(page);

    // 出勤の行の「修正」を押す。
    await page.locator('.punch-events li').first().getByRole('button', { name: '修正' }).click();

    await page.getByLabel('修正理由').fill('実際の出勤時刻に合わせるため');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.locator('.correction-form')).toHaveCount(0);

    await page.getByText('記録の履歴').click();
    await expect(page.getByText('実際の出勤時刻に合わせるため')).toBeVisible();
  });

  test('表示言語を英語へ切り替えられる', async ({ page }) => {
    await signIn(page);

    await selectLocale(page, 'en');

    await expect(page.getByRole('heading', { name: "Today's attendance" })).toBeVisible();
    await expect(page.locator('.work-state')).toHaveText('Finished');

    // 表示言語は利用者設定として保存されるため、後続のテストのために戻す。
    await selectLocale(page, 'ja-JP');
    await expect(page.locator('.work-state')).toHaveText('退勤済み');
  });

  test('ログアウトするとログイン画面へ戻る', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();

    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });
});
