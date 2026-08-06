import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_CROSS_BROWSER_ADMIN } from './setup/prepare-database.js';
import { overflowingElements } from './support/layout.js';

/**
 * 系統の違いが出るところを、主要な 3 系統で確かめる。
 *
 * 同じ HTML でも、日付の入力欄・焦点の移り方・書字の折り返し・
 * 時刻の読み取りは実装ごとに違う。1 つの系統だけで確かめると、
 * 他の系統でだけ壊れていることに気付けない。
 *
 * ここに置くのは、状態を変えない操作だけにする。
 * 変える操作を混ぜると、二度目の系統では前提が崩れ、
 * 系統の違いではなく順番のせいで落ちる。
 *
 * 見た目そのものの回帰は、画像では見ていない。
 * 画像は差分で中身を読めないため、このリポジトリでは追跡しない
 * （scripts/check-policy.sh）。代わりに、読み上げの木を文字として比べる。
 */

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('メールアドレス').fill(E2E_CROSS_BROWSER_ADMIN.email);
  await page.getByLabel('パスワード', { exact: true }).fill(E2E_CROSS_BROWSER_ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

test.describe('系統をまたいだ確認', () => {
  test('ログインして本日の勤怠が出る', async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole('heading', { level: 1, name: 'StaffWeave' })).toBeVisible();
    await expect(page.locator('.work-state')).toHaveText('出勤前');
  });

  test('ログイン前の画面の構造が変わらない', async ({ page }) => {
    await page.goto('/');

    // 読み上げの木を文字として比べる。要素の役割と名前が変わったら気付く。
    // 画像で比べないのは、差分で中身を読めないものを追跡しないため。
    await expect(page.locator('main')).toMatchAriaSnapshot(`
      - heading "StaffWeave" [level=1]
      - paragraph
      - text: メールアドレス
      - textbox "メールアドレス"
      - text: パスワード
      - textbox "パスワード"
      - button "ログイン"
    `);
  });

  test('設定の画面の骨組みが変わらない', async ({ page }) => {
    await signIn(page);
    await page.goto('/#/admin/organization/organizations');

    await expect(page.locator('.admin-modules')).toMatchAriaSnapshot(`
      - tablist "設定のモジュール":
        - tab "組織"
        - tab "従業員"
        - tab "勤務"
        - tab "月次"
        - tab "休暇"
        - tab "申請"
    `);
  });

  test('キーボードだけで本文へ入れる', async ({ page, browserName }) => {
    // WebKit は、Tab で移る先にリンクを含めるかどうかが OS の設定で決まる。
    // 既定では含めないため、ここで確かめられるのは他の 2 系統だけ。
    test.skip(browserName === 'webkit', 'Tab の移り先は OS の設定で決まる');
    await signIn(page);
    await page.keyboard.press('Tab');

    // 最初の焦点は本文への移動リンク。系統によって既定の焦点順が違う。
    // ログインの画面には置いていない。飛ばす先の繰り返しが無いため。
    await expect(page.getByRole('link', { name: '本文へ移動' })).toBeFocused();
  });

  test('左右キーでモジュールを移れる', async ({ page }) => {
    await signIn(page);
    await page.goto('/#/admin/organization/organizations');
    await page.getByRole('tab', { name: '組織' }).focus();
    await page.keyboard.press('ArrowRight');

    await expect(page.getByRole('tab', { name: '従業員' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('日付の入力欄へ値を入れられる', async ({ page }) => {
    await signIn(page);
    await page.goto('/#/admin/monthly/summaries');

    // 日付の入力欄は系統ごとに実装が違う。値の入れ方が通ることを見る。
    const period = page.locator('.admin-content').getByLabel('対象月');
    await period.fill('2026-04-01');

    await expect(period).toHaveValue('2026-04-01');
  });

  test('拠点の時計で時刻を読む', async ({ page }) => {
    await signIn(page);

    // 時刻の基準は拠点の時間帯。系統の既定の時間帯に引きずられないことを見る。
    await expect(page.getByText('Asia/Tokyo').first()).toBeVisible();
  });

  test('狭い画面でも本文が横にはみ出さない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);

    expect(await overflowingElements(page)).toEqual([]);
  });
});
