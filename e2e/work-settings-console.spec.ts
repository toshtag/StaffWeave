import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { E2E_ADMIN_CONSOLE_ADMIN } from './setup/prepare-database.js';

/**
 * 勤務の設定を、画面だけで一通り作れることを確かめる。
 *
 * 正しい勤怠計算に要る設定で curl や SQL を求めない、という条件を見る。
 * 組織から始めて、勤務区分・勤務パターン・勤務周期・勤務予定・労働形態まで
 * 画面で作り、その従業員が打刻したときに保存された計算と月次へ出るところまで
 * 1 本で通す。
 *
 * 途中で API を直に叩かない。叩くと「画面だけで作れるか」を確かめたことに
 * ならない。打刻だけは従業員の画面から行う。
 */

/** 検査どうしがコードを取り合わないよう、実行ごとに変える。 */
const RUN = `${Date.now() % 100000}`;
const ORGANIZATION = `E2E${RUN}`;
const CATEGORY = `CAT${RUN}`;
const PATTERN = `PAT${RUN}`;
const CYCLE = `CYC${RUN}`;
const EMPLOYEE_NUMBER = `W${RUN}`;
const EMPLOYEE_EMAIL = `work-${RUN}@example.test`;
const EMPLOYEE_PASSWORD = 'staffweave e2e pass';

function card(page: Page) {
  return page.locator('.admin-content section.card');
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');

  // 画面が落ち着くまで待ってから分ける。読み込みの途中で数えると、
  // 入っているのに「入っていない」と判断して入力欄を待ち続ける。
  const signOut = page.getByRole('button', { name: 'ログアウト', exact: true });
  const emailField = page.getByLabel('メールアドレス');
  await expect(signOut.or(emailField).first()).toBeVisible();

  if ((await signOut.count()) > 0) {
    await signOut.click();
    await expect(emailField).toBeVisible();
  }
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.locator('.work-state')).toBeVisible();
}

async function save(page: Page): Promise<void> {
  await card(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(card(page).getByRole('status')).toHaveText('保存しました');
}

/**
 * 保存したものが一覧へ現れるまで待つ。
 *
 * 一覧の読み直しは保存のあとに走る。待たずに選ぶと、まだ入っていない選択肢を
 * 選ぼうとして落ちる。
 */
async function listed(page: Page, code: string): Promise<void> {
  await expect(card(page).locator('tbody')).toContainText(code);
}

test.describe('勤務の設定を画面だけで作る', () => {
  test('組織から月次まで、画面だけで通す', async ({ page }) => {
    test.slow();
    await signIn(page, E2E_ADMIN_CONSOLE_ADMIN.email, E2E_ADMIN_CONSOLE_ADMIN.password);

    // 組織
    await page.goto('/#/admin/organization/organizations');
    await card(page).getByLabel('コード').fill(ORGANIZATION);
    await card(page).getByLabel('名称').fill('検証用の組織');
    await save(page);

    // 拠点。時間帯はここで決まる。
    await page.goto('/#/admin/organization/sites');
    await card(page)
      .getByLabel('組織')
      .selectOption({ label: `${ORGANIZATION} 検証用の組織` });
    await card(page).getByLabel('コード').fill(`S${RUN}`);
    await card(page).getByLabel('名称').fill('検証用の拠点');
    await save(page);

    // 従業員。打刻するため、利用者も一緒に作る。
    await page.goto('/#/admin/employee/employees');
    await card(page)
      .getByLabel('組織')
      .selectOption({ label: `${ORGANIZATION} 検証用の組織` });
    await card(page).getByLabel('従業員番号').fill(EMPLOYEE_NUMBER);
    await card(page).getByLabel('名称').fill('検証 勤務');
    await card(page).getByLabel('ログイン用の利用者も作る').check();
    await card(page).getByLabel('メールアドレス').fill(EMPLOYEE_EMAIL);
    await card(page).getByLabel('パスワード', { exact: true }).fill(EMPLOYEE_PASSWORD);
    await save(page);

    // 勤務区分。休憩と深夜帯と出勤日の扱いを、この画面で決める。
    await page.goto('/#/admin/work/categories');
    await card(page).getByLabel('コード').fill(CATEGORY);
    await card(page).getByLabel('管理用の名称').fill('検証用の勤務区分');
    await card(page).getByLabel('従業員へ見せる名称').fill('日勤');
    await card(page).getByLabel('区分の種別').selectOption('working_day');
    await card(page).getByLabel('適用開始日').fill('2026-01-01');
    await card(page).getByLabel('所定の開始', { exact: true }).fill('09:00');
    await card(page).getByLabel('所定の終了', { exact: true }).fill('18:00');
    await card(page).getByLabel('固定休憩の開始', { exact: true }).fill('12:00');
    await card(page).getByLabel('固定休憩の終了', { exact: true }).fill('13:00');
    await save(page);

    // 勤務パターン
    await page.goto('/#/admin/work/patterns');
    await card(page).getByLabel('コード').fill(PATTERN);
    await card(page).getByLabel('名称').fill('検証用のパターン');
    await card(page).getByLabel('所定の開始').fill('540');
    await card(page).getByLabel('所定の終了').fill('1080');
    await card(page).getByLabel('休憩（分）').fill('0');
    await save(page);

    // 勤務周期。作った直後に、その従業員へ割り当てて予定を作る。
    await page.goto('/#/admin/work/cycles');
    await card(page).getByLabel('コード').fill(CYCLE);
    await card(page).getByLabel('名称').fill('検証用の周期');
    await card(page).getByLabel('周期の長さ（日）').fill('7');
    await card(page).getByLabel('勤務日の数').fill('7');
    await card(page)
      .getByLabel('勤務パターン')
      .selectOption({ label: `${PATTERN} 検証用のパターン` });
    await card(page)
      .getByLabel('勤務区分')
      .selectOption({ label: `${CATEGORY} 日勤` });
    await save(page);
    await listed(page, CYCLE);

    const employeeOption = `${EMPLOYEE_NUMBER} 検証 勤務`;
    await card(page).getByLabel('従業員').selectOption({ label: employeeOption });
    await card(page)
      .getByRole('combobox', { name: '勤務周期' })
      .selectOption({ label: `${CYCLE} 検証用の周期` });
    await card(page).getByLabel('周期の起点日').fill('2026-04-01');
    await card(page).getByLabel('適用開始日').fill('2026-04-01');
    await card(page).getByRole('button', { name: '周期を割り当てる' }).click();
    await expect(card(page).getByText('割り当てました')).toBeVisible();

    await card(page).getByLabel('開始日', { exact: true }).fill('2026-04-01');
    await card(page).getByLabel('終了日', { exact: true }).fill('2026-04-30');
    await card(page).getByRole('button', { name: '予定を作る' }).click();
    await expect(card(page).getByText(/日分を作りました/)).toBeVisible();

    // 作った予定が、勤務区分つきで並ぶ。
    await page.goto('/#/admin/work/schedules');
    await card(page).getByLabel('従業員').selectOption({ label: employeeOption });
    await card(page).getByLabel('開始日', { exact: true }).fill('2026-04-01');
    await card(page).getByLabel('終了日', { exact: true }).fill('2026-04-30');
    await expect(card(page).locator('tbody tr').first()).toContainText(CATEGORY);

    // 労働形態。裁量のみなし時間を入れる。
    await page.goto('/#/admin/work/labor-systems');
    await card(page).getByLabel('従業員').selectOption({ label: employeeOption });
    await card(page).getByLabel('労働形態').selectOption('normal');
    await card(page).getByLabel('適用開始日').fill('2026-04-01');
    await save(page);

    // ここまでで、curl も SQL も使っていない。
    // 作った従業員で打刻し、保存された計算と月次に出ることを見る。
    await signIn(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    await page.getByRole('button', { name: '出勤' }).click();
    await expect(page.locator('.work-state')).toContainText('勤務中');
    await page.getByRole('button', { name: '退勤' }).click();
    await expect(page.locator('.work-state')).toContainText('退勤済み');

    // 管理者へ戻り、月次の集計にその従業員が出ることを見る。
    await signIn(page, E2E_ADMIN_CONSOLE_ADMIN.email, E2E_ADMIN_CONSOLE_ADMIN.password);
    await page.goto('/#/admin/monthly/summaries');
    await expect(card(page).locator('tbody')).toContainText(EMPLOYEE_NUMBER);
  });
});
