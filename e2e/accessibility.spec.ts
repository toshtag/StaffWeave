import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_CROSS_BROWSER_ADMIN } from './setup/prepare-database.js';

/**
 * 画面が WCAG 2.2 AA へ適合しているかを、機械で確かめられる範囲で見る。
 *
 * 機械で見えるのは全体の一部にすぎない。色の意味・読み上げの分かりやすさ・
 * 操作の順序が業務に合っているかは、人が確かめる必要がある。
 * ここで通ることを「適合した」とは言わない。
 *
 * それでも置くのは、見出しの飛び・ラベルの欠け・対比の不足のように、
 * 気付かないまま積み上がるものを止められるため。
 *
 * 違反は 1 件も許さない。「既知のぶんは除く」という一覧を作ると、
 * その一覧が伸びていくことに誰も気付かなくなる。
 */

/** 見るのは AA まで。AAA は本文の対比など、業務の画面では過剰な要求を含む。 */
const STANDARDS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(E2E_CROSS_BROWSER_ADMIN.email);
  await page.getByLabel('パスワード', { exact: true }).fill(E2E_CROSS_BROWSER_ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

async function violationsOf(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(STANDARDS).analyze();
  return result.violations.map(
    (violation) => `${violation.id}（${violation.nodes.length} 箇所）: ${violation.help}`,
  );
}

test.describe('アクセシビリティ', () => {
  test('ログインの画面', async ({ page }) => {
    await page.goto('/');

    expect(await violationsOf(page)).toEqual([]);
  });

  test('本日の勤怠の画面', async ({ page }) => {
    await signIn(page);

    expect(await violationsOf(page)).toEqual([]);
  });

  test('設定の画面', async ({ page }) => {
    await signIn(page);
    await page.goto('/#/admin/organization/organizations');
    await expect(page.getByRole('heading', { level: 2, name: '組織' })).toBeVisible();

    expect(await violationsOf(page)).toEqual([]);
  });

  test('月次の画面', async ({ page }) => {
    await signIn(page);
    await page.goto('/#/admin/monthly/summaries');
    await expect(page.getByRole('heading', { level: 2, name: '月次の集計' })).toBeVisible();

    expect(await violationsOf(page)).toEqual([]);
  });

  test('狭い画面のログイン', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    expect(await violationsOf(page)).toEqual([]);
  });
});
