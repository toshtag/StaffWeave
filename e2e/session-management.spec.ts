import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_SESSION_EMPLOYEE } from './setup/prepare-database.js';

/**
 * ログイン中の端末を一覧し、他の端末を終わらせられることを確かめる。
 *
 * 二つ目のセッションは別のブラウザ文脈から開く。同じ文脈で開き直すと Cookie が
 * 置き換わり、「別の端末が並んでいる」状態そのものを作れない。
 */

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(E2E_SESSION_EMPLOYEE.email);
  await page.getByLabel('パスワード', { exact: true }).fill(E2E_SESSION_EMPLOYEE.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

/** 別の端末に見えるセッションを開き、その画面を返す。 */
async function signInFromAnotherDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);
  return page;
}

function sessionRows(page: Page) {
  return page.locator('section.card', { hasText: 'ログイン中の端末' }).locator('tbody tr');
}

test.describe('ログイン中の端末', () => {
  /**
   * 同じ利用者で検査を重ねるため、前の検査が残したセッションを先に落とす。
   * 残したままだと、件数を数える検査が実行順に左右される。
   */
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    const revokeOthers = page.getByRole('button', { name: '他の端末からログアウトする' });
    if ((await revokeOthers.count()) > 0) {
      await revokeOthers.click();
    }
    await expect(sessionRows(page)).toHaveCount(1);
  });

  test.afterEach(async ({ page }) => {
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  });

  test('一覧に「この端末」が 1 件だけ付く', async ({ page }) => {
    const rows = sessionRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.getByText('この端末')).toHaveCount(1);
    // 端末は系統だけを出す。生の名乗りは画面にも出さない。
    await expect(rows.first()).not.toContainText('Mozilla');
  });

  test('他の端末を 1 件ずつ終わらせられる', async ({ page, browser }) => {
    const other = await signInFromAnotherDevice(browser);
    // 一覧は読み込んだ時点のもの。別の端末が入ったことは読み直して知る。
    await page.reload();

    const rows = sessionRows(page);
    await expect(rows).toHaveCount(2);

    // 「この端末」が付かない行にだけ操作がある。
    const otherRow = rows.filter({ hasNotText: 'この端末' });
    await otherRow.getByRole('button', { name: 'ログアウトさせる' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.getByText('この端末')).toHaveCount(1);

    // 終わらせた側は、次の読み込みで締め出される。
    await other.reload();
    await expect(other.getByRole('button', { name: 'ログイン' })).toBeVisible();
    await other.context().close();
  });

  test('いま使っている端末には、行から終わらせる操作を出さない', async ({ page }) => {
    const currentRow = sessionRows(page).filter({ hasText: 'この端末' });
    await expect(currentRow.getByRole('button', { name: 'ログアウトさせる' })).toHaveCount(0);
  });

  test('他の端末からまとめてログアウトでき、手元は残る', async ({ page, browser }) => {
    const first = await signInFromAnotherDevice(browser);
    const second = await signInFromAnotherDevice(browser);
    await page.reload();

    await expect(sessionRows(page)).toHaveCount(3);
    await page.getByRole('button', { name: '他の端末からログアウトする' }).click();

    await expect(page.getByRole('status')).toContainText('他の端末のセッションを終了しました');
    await expect(sessionRows(page)).toHaveCount(1);

    // 手元はそのまま使える。
    await page.reload();
    await expect(page.locator('.work-state')).toBeVisible();

    for (const other of [first, second]) {
      await other.reload();
      await expect(other.getByRole('button', { name: 'ログイン' })).toBeVisible();
      await other.context().close();
    }
  });

  test('他の端末が無ければ、まとめて終わらせる操作を出さない', async ({ page }) => {
    await expect(page.getByText('他の端末からのログインはありません。')).toBeVisible();
    await expect(page.getByRole('button', { name: '他の端末からログアウトする' })).toHaveCount(0);
  });
});
