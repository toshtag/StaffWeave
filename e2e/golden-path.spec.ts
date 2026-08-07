import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_GOLDEN_ADMIN, E2E_GOLDEN_MANAGER } from './setup/prepare-database.js';

/**
 * 製品を一巡する検査。
 *
 * 設定を作るところから、打刻・休暇・残業の申請・多段の承認・月次の締め・
 * 給与の受け渡し・締めの解除・訂正・締め直しまでを、画面だけで 1 本に通す。
 *
 * 個々の経路は他の検査が細かく見ている。ここで見たいのは、それらが順につながり、
 * 途中で人が製品の外へ出なくて済むこと。1 か所でも curl や SQL が要るなら、
 * 「使える製品」とは言えない。
 *
 * 打刻は当日に行う。打刻は未来へ置けず、24 時間より前へも戻せない。
 * 過去の記録を作るのは訂正の経路で、これもこの検査に含める。
 */

const RUN = `${Date.now() % 100000}`;
const ORGANIZATION = `G${RUN}`;
const CATEGORY = `GC${RUN}`;
const LEAVE_TYPE_CODE = 'PAID';
const OVERTIME_TYPE = `GO${RUN}`;
const LEAVE_REQUEST_TYPE = `GL${RUN}`;
const EMPLOYEE_NUMBER = `G${RUN}`;
const EMPLOYEE_EMAIL = `golden-${RUN}@example.test`;
const PASSWORD = 'staffweave e2e pass';

function card(page: Page) {
  return page.locator('.admin-content section.card');
}

function requestCenter(page: Page) {
  return page.locator('section[aria-labelledby="request-center-heading"]');
}

function approvals(page: Page) {
  return page.locator('.card', { has: page.getByRole('heading', { name: '承認待ちの申請' }) });
}

function dailyApprovals(page: Page) {
  return page.locator('section[aria-labelledby="daily-approvals-heading"]');
}

function history(page: Page) {
  return page.locator('section[aria-labelledby="attendance-history-heading"]');
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  const signOut = page.getByRole('button', { name: 'ログアウト', exact: true });
  const emailField = page.getByLabel('メールアドレス');
  await expect(signOut.or(emailField).first()).toBeVisible();
  if ((await signOut.count()) > 0) {
    await signOut.click();
    await expect(emailField).toBeVisible();
  }
  await emailField.fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

async function save(page: Page): Promise<void> {
  await card(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(card(page).getByRole('status')).toHaveText('保存しました');
}

/** その月の 1 日。締めの対象月として使う。 */
function firstOfThisMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
}

test.describe('製品を一巡する', () => {
  test('設定から締め直しまでを、画面だけで通す', async ({ page }) => {
    test.slow();
    const today = new Date().toISOString().slice(0, 10);
    const period = firstOfThisMonth();

    // --- 設定 ---------------------------------------------------------------
    await signIn(page, E2E_GOLDEN_ADMIN.email, E2E_GOLDEN_ADMIN.password);

    await page.goto('/#/admin/organization/organizations');
    await card(page).getByLabel('コード').fill(ORGANIZATION);
    await card(page).getByLabel('名称').fill('一巡の組織');
    await save(page);

    await page.goto('/#/admin/employee/employees');
    await card(page)
      .getByLabel('組織')
      .selectOption({ label: `${ORGANIZATION} 一巡の組織` });
    await card(page).getByLabel('従業員番号').fill(EMPLOYEE_NUMBER);
    await card(page).getByLabel('名称').fill('一巡 花子');
    await card(page).getByLabel('ログイン用の利用者も作る').check();
    await card(page).getByLabel('メールアドレス').fill(EMPLOYEE_EMAIL);
    await card(page).getByLabel('パスワード', { exact: true }).fill(PASSWORD);
    await save(page);

    await page.goto('/#/admin/work/categories');
    await card(page).getByLabel('コード').fill(CATEGORY);
    await card(page).getByLabel('管理用の名称').fill('一巡の勤務区分');
    await card(page).getByLabel('従業員へ見せる名称').fill('日勤');
    await card(page).getByLabel('区分の種別').selectOption('working_day');
    await card(page).getByLabel('適用開始日').fill('2026-01-01');
    await save(page);

    // 休暇種別に 1 日ぶんの分数を入れる。入れないと台帳へ反映できない。
    await page.goto('/#/admin/leave/leave-types');
    const leaveRow = card(page).locator('tbody tr', { hasText: LEAVE_TYPE_CODE });
    await leaveRow.getByRole('button', { name: 'この行を直す' }).click();
    await card(page).getByLabel('1 日ぶんの分数').fill('480');
    await save(page);

    // 申請種別を 2 つ。休暇は 1 段、残業は 2 段。
    await page.goto('/#/admin/request/request-types');
    await card(page).getByLabel('コード').fill(LEAVE_REQUEST_TYPE);
    await card(page).getByLabel('名称').fill('一巡の休暇');
    await card(page).getByLabel('区分').selectOption('leave');
    await card(page).getByLabel('承認の段数').fill('1');
    await card(page).getByLabel('1 段目 承認者').selectOption('workspace_admin');
    await save(page);

    await card(page).getByLabel('コード').fill(OVERTIME_TYPE);
    await card(page).getByLabel('名称').fill('一巡の残業');
    await card(page).getByLabel('区分').selectOption('overtime');
    await card(page).getByLabel('承認の段数').fill('2');
    await card(page).getByLabel('1 段目 承認者').selectOption('organization_manager');
    await card(page).getByLabel('2 段目 承認者').selectOption('workspace_admin');
    // 上限を求める種別にする。求めないと、申請の画面に入力欄が出ない。
    await card(page).getByLabel('残業の上限時刻', { exact: true }).check();
    await save(page);

    // 1 段目を承認する組織の管理者へ、この組織を見る範囲を与える。
    // 範囲が無ければ、その申請は承認者の手元に出てこない。
    await page.goto('/#/admin/employee/scopes');
    await card(page).getByLabel('利用者').selectOption({ label: 'E020 検証 二十郎' });
    await card(page)
      .getByLabel('組織')
      .selectOption({ label: `${ORGANIZATION} 一巡の組織` });
    await save(page);

    // 休暇の残数を入れる。規則が無くても、1 件ずつなら台帳へ積める。
    await page.goto('/#/admin/leave/ledger');
    await card(page)
      .getByLabel('従業員')
      .selectOption({ label: `${EMPLOYEE_NUMBER} 一巡 花子` });
    await card(page).getByLabel('休暇種別').selectOption({ index: 0 });
    await card(page).getByLabel('分数').fill('4800');
    await card(page).getByLabel('効力の日').fill('2026-01-01');
    await save(page);

    // --- 打刻 ---------------------------------------------------------------
    await signIn(page, EMPLOYEE_EMAIL, PASSWORD);
    await page.getByRole('button', { name: '出勤' }).click();
    await expect(page.locator('.work-state')).toContainText('勤務中');
    await page.getByRole('button', { name: '退勤' }).click();
    await expect(page.locator('.work-state')).toContainText('退勤済み');

    // 過去の勤怠の画面から、その日の記録を辿れる。
    // 打刻が保存へ届くのは、画面の表示が変わるより後になり得る。
    // 届くまで読み直す。届かなければ、ここで落ちる。
    await expect(async () => {
      await history(page).getByRole('button', { name: '読み直す' }).click();
      await expect(history(page).locator('.history-list > li', { hasText: today })).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 30000 });

    // --- 申請 ---------------------------------------------------------------
    await requestCenter(page).getByLabel('申請の種別').selectOption({ label: '一巡の休暇' });
    await requestCenter(page).getByLabel('対象日').fill(today);
    await requestCenter(page).getByLabel('休暇種別').selectOption({ index: 0 });
    await requestCenter(page).getByLabel('理由').fill('私用のため');
    await requestCenter(page).getByRole('button', { name: '申請する' }).click();
    await expect(requestCenter(page).getByRole('status')).toHaveText('申請しました');

    await requestCenter(page).getByLabel('申請の種別').selectOption({ label: '一巡の残業' });
    await requestCenter(page).getByLabel('対象日').fill(today);
    await requestCenter(page).getByLabel('残業の上限時刻（現地 0 時からの分）').fill('1260');
    await requestCenter(page).getByLabel('理由').fill('対応のため');
    await requestCenter(page).getByRole('button', { name: '申請する' }).click();
    await expect(requestCenter(page).getByRole('status')).toHaveText('申請しました');

    // その日の勤怠を確定させる。締めるための前提になる。
    await page.getByRole('button', { name: 'この日の勤怠を申請する' }).click();

    // --- 多段の承認 ---------------------------------------------------------
    // 残業の 1 段目は組織の管理者。
    await signIn(page, E2E_GOLDEN_MANAGER.email, E2E_GOLDEN_MANAGER.password);
    const overtime = approvals(page).locator('li', { hasText: '一巡の残業' });
    await expect(overtime).toBeVisible();
    await overtime.getByRole('button', { name: '承認' }).click();

    // 休暇と残業の残りは、ワークスペースの管理者。
    await signIn(page, E2E_GOLDEN_ADMIN.email, E2E_GOLDEN_ADMIN.password);
    for (const name of ['一巡の休暇', '一巡の残業']) {
      const pending = approvals(page).locator('li', { hasText: name });
      await expect(pending).toBeVisible();
      await pending.getByRole('button', { name: '承認' }).click();
      await expect(pending).toHaveCount(0);
    }

    // 日次の確定も承認する。
    await dailyApprovals(page)
      .locator('li', { hasText: today })
      .getByRole('button', { name: '承認' })
      .click();
    await expect(dailyApprovals(page).locator('li', { hasText: today })).toHaveCount(0);

    // --- 締めと給与 ---------------------------------------------------------
    await page.goto('/#/admin/monthly/readiness');
    await card(page).getByLabel('対象月').fill(period);
    // 締めは従業員ごとに行う。他の検査の行を巻き込まないよう、自分の行だけを触る。
    const row = card(page).locator('tbody tr', { hasText: `${EMPLOYEE_NUMBER} 一巡 花子` });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: '締める' }).click();
    await expect(card(page).getByText('締めました')).toBeVisible();

    const download = page.waitForEvent('download');
    await card(page).getByRole('button', { name: '給与の CSV を取り出す' }).click();
    expect((await download).suggestedFilename()).toBe(`payroll-${period}.csv`);

    // --- 締め解除・訂正・締め直し -------------------------------------------
    await row.getByRole('button', { name: '締めを解除する' }).click();
    await row.getByLabel('解除の理由').fill('打刻の訂正のため');
    await row.getByRole('button', { name: '保存' }).click();
    await expect(card(page).getByText('締めを解除しました')).toBeVisible();

    // 解除したので、その日を直せる。締めたままでは直せない。
    await signIn(page, EMPLOYEE_EMAIL, PASSWORD);
    const correct = page.getByRole('button', { name: '修正', exact: true }).first();
    await expect(correct).toBeVisible();
    await correct.click();
    await page.getByLabel('修正理由').fill('打刻の時刻を直すため');
    await page.locator('form.correction-form').getByRole('button', { name: '保存' }).click();
    await expect(page.getByLabel('修正理由')).toHaveCount(0);

    // 直した日は、もう一度その日の勤怠を出し直す。出し直さないと締められない。
    await page.getByRole('button', { name: 'この日の勤怠を申請する' }).click();

    // 直したうえで締め直す。
    await signIn(page, E2E_GOLDEN_ADMIN.email, E2E_GOLDEN_ADMIN.password);
    await dailyApprovals(page)
      .locator('li', { hasText: today })
      .getByRole('button', { name: '承認' })
      .click();
    await expect(dailyApprovals(page).locator('li', { hasText: today })).toHaveCount(0);

    await page.goto('/#/admin/monthly/readiness');
    await card(page).getByLabel('対象月').fill(period);
    await card(page)
      .locator('tbody tr', { hasText: `${EMPLOYEE_NUMBER} 一巡 花子` })
      .getByRole('button', { name: '締める' })
      .click();
    await expect(card(page).getByText('締めました')).toBeVisible();
  });
});
