import { expect, test } from '@playwright/test';
import { E2E_PASSWORD_EMPLOYEE } from './setup/prepare-database.js';

/**
 * 画面からパスワードを変更できることを確かめる。
 *
 * 変更すると古いパスワードでは入れなくなるため、この検査だけの従業員を使う。
 */

const NEW_PASSWORD = 'staffweave e2e changed';

async function signIn(page: import('@playwright/test').Page, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(E2E_PASSWORD_EMPLOYEE.email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

test.describe('パスワードの変更', () => {
  test('現在のパスワードを確かめて変更し、新しいパスワードで入り直せる', async ({ page }) => {
    await signIn(page, E2E_PASSWORD_EMPLOYEE.password);

    await page.getByLabel('現在のパスワード').fill(E2E_PASSWORD_EMPLOYEE.password);
    await page.getByLabel('新しいパスワード').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'パスワードの変更' }).click();

    await expect(page.getByRole('status')).toContainText('パスワードを変更しました');

    // 変更した端末のセッションはそのまま使える。
    await page.reload();
    await expect(page.locator('.work-state')).toBeVisible();

    await page.getByRole('button', { name: 'ログアウト' }).click();
    await signIn(page, NEW_PASSWORD);
  });

  test('現在のパスワードが違えば変更しない', async ({ page }) => {
    await signIn(page, NEW_PASSWORD);

    await page.getByLabel('現在のパスワード').fill('staffweave e2e wrong');
    await page.getByLabel('新しいパスワード').fill('staffweave e2e another');
    await page.getByRole('button', { name: 'パスワードの変更' }).click();

    await expect(page.getByRole('alert')).toBeVisible();

    // 変更されていないため、そのままのパスワードで入り直せる。
    await page.getByRole('button', { name: 'ログアウト' }).click();
    await signIn(page, NEW_PASSWORD);
  });
});
