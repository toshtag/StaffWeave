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
 *
 * 予定は検査の当日へ作る。以前は 2026-04 に固定して作り、打刻は現在日で行って
 * いた。現在日がその期間の外でも通るため、作った設定が打刻の計算へ効いたことを
 * 何も示していなかった。
 *
 * 確かめる値も具体的にする。勤務区分へ入れた所定労働分数（420 分）が、日次の
 * 計算にも月次の集計にも出ることを見る。予定の時刻から出る 540 分とも、
 * 固定休憩を引いた 480 分とも違う値にしてあるので、この値が出るのは
 * 画面で作った勤務区分がその日の計算に選ばれたときだけ。
 * 勤務区分・予定・割り当てのどれかが欠ければ、この検査は落ちる。
 */

/** 検査の当日。予定はこの日へ作る。 */
const TODAY = new Date().toISOString().slice(0, 10);
/** 当月の 1 日。月次はこの月を見る。 */
const PERIOD = `${TODAY.slice(0, 7)}-01`;
/**
 * 勤務区分に入れる所定労働分数。
 *
 * 09:00–18:00（540 分）でも、そこから固定休憩を引いた 480 分でもない値にする。
 * この値が出るのは、画面で作った勤務区分がその日の計算に選ばれたときだけ。
 * 予定の時刻から出る値と同じにすると、区分が効いていなくても通ってしまう。
 */
const SCHEDULED_MINUTES = 420;

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
    await card(page).getByLabel('所定労働分数').fill(String(SCHEDULED_MINUTES));
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
    await card(page).getByLabel('周期の起点日').fill(TODAY);
    await card(page).getByLabel('適用開始日').fill(TODAY);
    await card(page).getByRole('button', { name: '周期を割り当てる' }).click();
    await expect(card(page).getByText('割り当てました')).toBeVisible();

    // 当日の 1 日だけを作る。月次の所定労働がその 1 日ぶんちょうどになり、
    // 効いているかどうかを数字で言い切れる。
    await card(page).getByLabel('開始日', { exact: true }).fill(TODAY);
    await card(page).getByLabel('終了日', { exact: true }).fill(TODAY);
    await card(page).getByRole('button', { name: '予定を作る' }).click();
    await expect(card(page).getByText(/日分を作りました/)).toBeVisible();

    // 作った予定が、勤務区分つきで並ぶ。
    await page.goto('/#/admin/work/schedules');
    await card(page).getByLabel('従業員').selectOption({ label: employeeOption });
    await card(page).getByLabel('開始日', { exact: true }).fill(TODAY);
    await card(page).getByLabel('終了日', { exact: true }).fill(TODAY);
    await expect(card(page).locator('tbody tr', { hasText: TODAY })).toContainText(CATEGORY);

    // 労働形態。裁量のみなし時間を入れる。
    await page.goto('/#/admin/work/labor-systems');
    await card(page).getByLabel('従業員').selectOption({ label: employeeOption });
    await card(page).getByLabel('労働形態').selectOption('normal');
    await card(page).getByLabel('適用開始日').fill(TODAY);
    await save(page);

    // ここまでで、curl も SQL も使っていない。
    // 作った従業員で打刻し、保存された計算と月次に出ることを見る。
    await signIn(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    await page.getByRole('button', { name: '出勤' }).click();
    await expect(page.locator('.work-state')).toContainText('勤務中');
    await page.getByRole('button', { name: '退勤' }).click();
    await expect(page.locator('.work-state')).toContainText('退勤済み');

    // 画面で作った勤務区分が、その打刻の計算へ効いていること。
    // 従業員番号が並ぶだけでは、設定が効いたことを何も示さない。
    const details = page.locator('.calculation-details');
    await expect(
      details.locator('dt', { hasText: '所定労働' }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('7時間0分');

    // 管理者へ戻り、月次にも同じ値が出ることを見る。
    await signIn(page, E2E_ADMIN_CONSOLE_ADMIN.email, E2E_ADMIN_CONSOLE_ADMIN.password);
    await page.goto('/#/admin/monthly/summaries');
    await card(page).getByLabel('対象月').fill(PERIOD);
    const monthly = card(page).locator('tbody tr', { hasText: EMPLOYEE_NUMBER });
    await expect(monthly).toBeVisible();
    await expect(monthly).toContainText(String(SCHEDULED_MINUTES));
  });
});
