import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_ADMIN_CONSOLE_ADMIN, E2E_ADMIN_CONSOLE_EMPLOYEE } from './setup/prepare-database.js';
import { overflowingElements } from './support/layout.js';

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
    // 段ごとの承認者を決めるまでは保存できない。既定では埋まっていない。
    await card(page).getByLabel('1 段目 承認者').selectOption('workspace_admin');
    await card(page).getByLabel('2 段目 承認者').selectOption('organization_manager');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    const row = card(page).locator('tbody tr', { hasText: code });
    await expect(row).toContainText('2');

    await row.getByRole('button', { name: 'この行を直す' }).click();
    await card(page).getByLabel('承認の段数').fill('3');
    await card(page).getByLabel('3 段目 承認者').selectOption('workspace_admin');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    await expect(card(page).locator('tbody tr', { hasText: code })).toContainText('3');
  });

  /**
   * 決めていない段があるまま保存させない。
   *
   * 保存できてしまうと、設定の画面では正しく見えるのに、その種別では
   * 申請を出せない状態が残る。
   */
  test('承認者を決めていない段があると保存できない', async ({ page }) => {
    await page.goto('/#/admin/request/request-types');
    const code = `REQ${(Date.now() + 1) % 100000}`;

    await card(page).getByLabel('コード').fill(code);
    await card(page).getByLabel('名称').fill('経路なしの申請');
    await card(page).getByLabel('区分').selectOption('other');
    await card(page).getByLabel('承認の段数').fill('2');
    await card(page).getByLabel('1 段目 承認者').selectOption('workspace_admin');
    // 2 段目は未設定のまま。
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    await expect(card(page).getByRole('alert')).toContainText('すべての段の承認者');
    await expect(card(page).locator('tbody')).not.toContainText(code);
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

  /**
   * フレックスと変形は、DB が清算期間の総枠を必須にしている。
   * 画面がその欄を持たないと、制度は選べるのに登録だけが失敗する。
   * 送って終わりにせず、一覧へ現れるところまで見る。
   */
  test('フレックスの割当を、清算期間の総枠まで入れて登録できる', async ({ page }) => {
    await page.goto('/#/admin/work/labor-systems');
    await expect(page.getByRole('heading', { level: 2, name: '労働形態' })).toBeVisible();

    // 割当は期間が重ならない。検査どうしが同じ従業員を取り合わないよう、
    // 対象者を分け、終了日も入れて閉じておく。
    await card(page).getByLabel('従業員').selectOption({ label: 'E010 検証 十郎' });
    await card(page).getByLabel('労働形態').selectOption('flex');
    await card(page).getByLabel('適用開始日').fill('2027-01-01');
    await card(page).getByLabel('清算期間の月数').fill('3');
    await card(page).getByLabel('清算期間の起算日').fill('2027-01-01');
    await card(page).getByLabel('清算期間の総枠（分）').fill('9000');
    await card(page).getByLabel('総枠の決め方').selectOption('prescribed');
    await card(page).getByLabel('コアタイムの開始（分）').fill('660');
    await card(page).getByLabel('コアタイムの終了（分）').fill('900');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    await expect(card(page).getByRole('status')).toHaveText('保存しました');
    await expect(card(page).locator('tbody tr', { hasText: '2027-01-01' })).toContainText('9000');
  });

  test('変形の割当も、清算期間の総枠まで入れて登録できる', async ({ page }) => {
    await page.goto('/#/admin/work/labor-systems');

    await card(page).getByLabel('従業員').selectOption({ label: 'E011 検証 十一郎' });
    await card(page).getByLabel('労働形態').selectOption('variable');
    await card(page).getByLabel('適用開始日').fill('2027-04-01');
    await card(page).getByLabel('清算期間の月数').fill('1');
    await card(page).getByLabel('清算期間の起算日').fill('2027-04-01');
    await card(page).getByLabel('清算期間の総枠（分）').fill('10440');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    await expect(card(page).getByRole('status')).toHaveText('保存しました');
    await expect(card(page).locator('tbody tr', { hasText: '2027-04-01' })).toContainText('10440');
  });

  test('裁量の割当は、みなし分数を入れて登録できる', async ({ page }) => {
    await page.goto('/#/admin/work/labor-systems');

    await card(page).getByLabel('従業員').selectOption({ label: 'E012 検証 十二郎' });
    await card(page).getByLabel('労働形態').selectOption('discretionary');
    await card(page).getByLabel('適用開始日').fill('2027-07-01');
    await card(page).getByLabel('みなし分数').fill('420');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();

    await expect(card(page).getByRole('status')).toHaveText('保存しました');
    await expect(card(page).locator('tbody tr', { hasText: '2027-07-01' })).toContainText('420');
  });

  /**
   * 画面の表は表示の言語で出し、取込は機械の見出しを求める。
   * 同じ CSV を両方に使うと、表示の言語を変えただけで取り込めなくなる。
   * 取込用の出力が、本当に機械の見出しで出ることを見る。
   */
  test('取込用の CSV は、機械の見出しと値で出る', async ({ page }) => {
    await page.goto('/#/admin/work/categories');

    // 出す対象が無いと、取り出す操作そのものが出ない。1 件作ってから見る。
    const code = `CSV${Date.now() % 100000}`;
    await card(page).getByLabel('コード').fill(code);
    await card(page).getByLabel('管理用の名称').fill('取り出しの検証');
    await card(page).getByLabel('従業員へ見せる名称').fill('日勤');
    await card(page).getByLabel('区分の種別').selectOption('working_day');
    await card(page).getByLabel('適用開始日').fill('2027-06-01');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();
    await expect(card(page).getByRole('status')).toHaveText('保存しました');

    const download = page.waitForEvent('download');
    await card(page).getByRole('button', { name: '取込用の CSV を取り出す' }).click();
    const file = await download;

    expect(file.suggestedFilename()).toBe('work-categories-import.csv');

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');

    // 見出しは機械の名前。表示の名前では出さない。
    expect(text).toContain('code');
    expect(text).toContain('category_type');
    expect(text).not.toContain('区分の種別');
  });

  test('月次の集計を、対象月を選んで見られる', async ({ page }) => {
    await page.goto('/#/admin/monthly/summaries');
    await expect(page.getByRole('heading', { level: 2, name: '月次の集計' })).toBeVisible();

    await card(page).getByLabel('対象月').fill('2026-04-01');

    // 打刻の無い月でも、従業員の行は出る。集計が 0 であることが分かる。
    await expect(card(page).locator('tbody tr').first()).toBeVisible();
  });

  test('締める前の確認を見られる', async ({ page }) => {
    await page.goto('/#/admin/monthly/readiness');

    await expect(page.getByRole('heading', { level: 2, name: '締める前の確認' })).toBeVisible();
  });

  test('狭い画面でも本文が横にはみ出さない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/admin/organization/organizations');
    await expect(page.getByRole('heading', { level: 2, name: '組織' })).toBeVisible();

    expect(await overflowingElements(page)).toEqual([]);
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
