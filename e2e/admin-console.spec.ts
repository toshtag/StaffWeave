import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_ADMIN_CONSOLE_ADMIN, E2E_ADMIN_CONSOLE_EMPLOYEE } from './setup/prepare-database.js';

/**
 * 設定の画面を、API や SQL を使わずに一通り触れることを確かめる。
 *
 * 目安は「管理者が画面だけで初期設定を終えられること」。
 * 作った結果が一覧へ現れるところまで見て、送っただけで終わらせない。
 *
 * 見えてはいけない設定が見えないことも同じ場所で確かめる。
 * 権限の判断はサーバーが持つが、押せるボタンを出しておいて 403 を返すのでは、
 * 何ができるのかが利用者に伝わらない。
 */

async function signIn(page: Page, account: typeof E2E_ADMIN_CONSOLE_ADMIN): Promise<void> {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(account.email);
  await page.getByLabel('パスワード', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

function card(page: Page) {
  return page.locator('.admin-content section.card');
}

test.describe('設定の画面', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, E2E_ADMIN_CONSOLE_ADMIN);
    await page.getByRole('link', { name: '設定を開く' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  });

  test('組織を作ると一覧へ現れる', async ({ page }) => {
    const code = `E2E${Date.now() % 100000}`;
    await card(page).getByLabel('コード').fill(code);
    await card(page).getByLabel('名称').fill('検証用の組織');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    await expect(card(page).getByRole('status')).toHaveText('保存しました');
    await expect(card(page).locator('tbody')).toContainText(code);
  });

  test('モジュールを左右キーで移れる', async ({ page }) => {
    const tabs = page.getByRole('tab');
    await tabs.filter({ hasText: '組織' }).focus();
    await page.keyboard.press('ArrowRight');

    await expect(page.getByRole('tab', { name: '従業員' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { level: 2, name: '従業員' })).toBeVisible();
  });

  test('URL からその設定を直接開ける', async ({ page }) => {
    await page.goto('/#/admin/request/request-types');

    await expect(page.getByRole('heading', { level: 2, name: '申請種別と承認経路' })).toBeVisible();
  });

  test('申請種別を作り、あとから承認の段数を直せる', async ({ page }) => {
    await page.goto('/#/admin/request/request-types');
    const code = `REQ${Date.now() % 100000}`;

    await card(page).getByLabel('コード').fill(code);
    await card(page).getByLabel('名称').fill('検証用の申請');
    await card(page).getByLabel('区分').selectOption('overtime');
    await card(page).getByLabel('承認の段数').fill('2');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    const row = card(page).locator('tbody tr', { hasText: code });
    await expect(row).toContainText('2');

    await row.getByRole('button', { name: 'この行を直す' }).click();
    await card(page).getByLabel('承認の段数').fill('3');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    await expect(card(page).locator('tbody tr', { hasText: code })).toContainText('3');
  });

  test('休暇種別は既定では未設定で、あとから取得の単位を入れられる', async ({ page }) => {
    await page.goto('/#/admin/leave/leave-types');
    const row = card(page).locator('tbody tr', { hasText: 'PAID' });

    // 製品は既定値を持たない。設定するまで未設定として出る。
    await expect(row).toContainText('未設定');

    await row.getByRole('button', { name: 'この行を直す' }).click();
    await card(page).getByLabel('取得の単位（分）').fill('60');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    await expect(card(page).getByRole('status')).toHaveText('保存しました');
    await expect(card(page).locator('tbody tr', { hasText: 'PAID' })).toContainText('60');
  });

  test('狭い画面でも本文が横にはみ出さない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/admin/organization/organizations');
    await expect(page.getByRole('heading', { level: 2, name: '組織' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('設定の画面の権限', () => {
  test('従業員には設定への入口を出さない', async ({ page }) => {
    await signIn(page, E2E_ADMIN_CONSOLE_EMPLOYEE);

    await expect(page.getByRole('link', { name: '設定を開く' })).toHaveCount(0);
  });

  test('従業員が URL を直接開いても、設定は出さない', async ({ page }) => {
    await signIn(page, E2E_ADMIN_CONSOLE_EMPLOYEE);
    await page.goto('/#/admin/organization/organizations');

    await expect(page.getByText('あなたが設定できる項目はありません。')).toBeVisible();
  });
});
