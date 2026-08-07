import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_ADMIN_CONSOLE_ADMIN } from './setup/prepare-database.js';

/**
 * 月次の締め・締め解除・給与 CSV の受け渡しを、設定の画面だけで行えること。
 *
 * これまで API client には close/reopen があるのに、画面から呼ぶ箇所が無く、
 * 締める前の確認は読み取り専用だった。給与向けの CSV も画面から取り出せない。
 *
 * ここでは、残っているものを見てから締め、締め解除には理由が要ることを見る。
 * 別の画面へ分けると「見ずに押す」経路ができるため、同じ画面に置いている。
 */

function card(page: Page) {
  return page.locator('.admin-content section.card');
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(E2E_ADMIN_CONSOLE_ADMIN.email);
  await page.getByLabel('パスワード', { exact: true }).fill(E2E_ADMIN_CONSOLE_ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

test.describe('月次の締め', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/#/admin/monthly/readiness');
    await expect(page.getByRole('heading', { level: 2, name: '締める前の確認' })).toBeVisible();
  });

  test('締めてから、理由を添えて解除できる', async ({ page }) => {
    // 打刻の無い月を選ぶ。残っているものが無ければ、そのまま締められる。
    await card(page).getByLabel('対象月').fill('2027-01-01');
    const row = card(page).locator('tbody tr').first();
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: '締める' }).click();
    await expect(card(page).getByText('締めました')).toBeVisible();

    // 解除は理由を求める。理由が空のままでは押せない。
    await row.getByRole('button', { name: '締めを解除する' }).click();
    const save = row.getByRole('button', { name: '保存' });
    await expect(save).toBeDisabled();

    await row.getByLabel('解除の理由').fill('訂正のため');
    await save.click();
    await expect(card(page).getByText('締めを解除しました')).toBeVisible();
  });

  test('給与の CSV を画面から取り出せる', async ({ page }) => {
    await card(page).getByLabel('対象月').fill('2027-02-01');

    const download = page.waitForEvent('download');
    await card(page).getByRole('button', { name: '給与の CSV を取り出す' }).click();

    expect((await download).suggestedFilename()).toBe('payroll-2027-02-01.csv');
  });
});
