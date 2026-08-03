import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_API_KEY_ADMIN, E2E_EMPLOYEE } from './setup/prepare-database.js';

/**
 * 画面から API キーを作り、失効させられることを確かめる。
 *
 * 生の鍵は作成の応答にしか現れない。控える機会が一度きりであることと、
 * 一覧へ二度と出てこないことを、画面を通して確かめる。
 */

const SECRET_PATTERN = /^sw_[0-9a-f]{8}_/;

async function signIn(page: Page, account: typeof E2E_API_KEY_ADMIN): Promise<void> {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(account.email);
  await page.getByLabel('パスワード', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

function apiKeyCard(page: Page) {
  return page.locator('section.card', { hasText: 'API キー' });
}

function apiKeyRows(page: Page) {
  return apiKeyCard(page).locator('tbody tr');
}

async function createKey(page: Page, name: string, scope: string): Promise<string> {
  const card = apiKeyCard(page);
  await card.getByLabel('名前').fill(name);
  await card.getByLabel(scope).check();
  await card.getByRole('button', { name: 'API キーを作る' }).click();

  const secret = await card.locator('.secret-value').textContent();
  if (secret === null) throw new Error('鍵が表示されませんでした');
  return secret;
}

test.describe('API キーの管理', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, E2E_API_KEY_ADMIN);
    // 前の検査が残した有効な鍵を落とす。失効済みの行は残る仕様のため、
    // 件数ではなく名前で数える検査にしてある。
    const revoke = apiKeyCard(page).getByRole('button', { name: '失効させる' });
    while ((await revoke.count()) > 0) {
      const before = await revoke.count();
      await revoke.first().click();
      await expect(revoke).toHaveCount(before - 1);
    }
  });

  test('作った直後にだけ鍵を表示し、一覧には出さない', async ({ page }) => {
    const card = apiKeyCard(page);
    const secret = await createKey(page, '給与連携', '給与連携向けの出力');

    expect(secret).toMatch(SECRET_PATTERN);
    await expect(card.getByRole('status')).toContainText('この値は今だけ表示されます');

    // 控えたら自分で閉じる。閉じたあとは画面のどこにも残らない。
    await card.getByRole('button', { name: '控えたので閉じる' }).click();
    await expect(card.locator('.secret-value')).toHaveCount(0);
    await expect(card).not.toContainText(secret);

    // 読み直しても出てこない。
    await page.reload();
    await expect(apiKeyCard(page)).not.toContainText(secret);
  });

  test('一覧に名前・先頭 8 文字・許した範囲が出る', async ({ page }) => {
    const secret = await createKey(page, '勤怠の読み取り', '勤怠と集計の読み取り');
    await apiKeyCard(page).getByRole('button', { name: '控えたので閉じる' }).click();

    const row = apiKeyRows(page).filter({ hasText: '勤怠の読み取り' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('勤怠と集計の読み取り');
    // 一覧に出るのは見分けるための先頭だけで、鍵そのものではない。
    await expect(row.locator('code')).toHaveText(secret.slice(3, 11));
    await expect(row).toContainText('未使用');
  });

  test('許す範囲を選ばなければ作らせない', async ({ page }) => {
    const card = apiKeyCard(page);
    await card.getByLabel('名前').fill('範囲なし');
    await card.getByRole('button', { name: 'API キーを作る' }).click();

    await expect(card.getByRole('alert')).toContainText('許す範囲を 1 つ以上選んでください');
    await expect(apiKeyRows(page).filter({ hasText: '範囲なし' })).toHaveCount(0);
  });

  test('失効させた鍵は印付きで残り、操作は消える', async ({ page }) => {
    await createKey(page, '失効させる鍵', '給与連携向けの出力');
    const card = apiKeyCard(page);
    await card.getByRole('button', { name: '控えたので閉じる' }).click();

    const row = apiKeyRows(page).filter({ hasText: '失効させる鍵' });
    await row.getByRole('button', { name: '失効させる' }).click();

    // 記録は消さない。消すと、連携が止まった理由を後から辿れなくなる。
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('失効済み');
    await expect(row.getByRole('button', { name: '失効させる' })).toHaveCount(0);
  });

  // 表示言語は利用者の設定として保存される。戻さずに終えると、
  // 次の検査が英語の画面を相手にすることになる。
  test('英語の画面では範囲の説明も英語で出る', async ({ page }) => {
    await page.getByLabel('表示言語').selectOption('en');

    const card = page.locator('section.card', { hasText: 'API keys' });
    await expect(card).toContainText('Payroll export');
    await expect(card).toContainText('Read attendance and totals');
    await expect(card).not.toContainText('給与連携向けの出力');

    await page.getByLabel('Language').selectOption('ja-JP');
    await expect(apiKeyCard(page)).toBeVisible();
  });

  test('権限のない利用者には節ごと出さない', async ({ page }) => {
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await signIn(page, E2E_EMPLOYEE);

    await expect(page.locator('section.card', { hasText: 'API キー' })).toHaveCount(0);
  });
});
