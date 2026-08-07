import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  E2E_ADMIN_CONSOLE_ADMIN,
  E2E_REQUEST_EMPLOYEE,
  E2E_REQUEST_MANAGER,
} from './setup/prepare-database.js';

/**
 * 申請種別に基づく申請・段階承認・差し戻し・出し直し・取消を、画面から扱えること。
 *
 * これまで通常の利用者が触れたのは旧の日次申請の画面だけで、休暇・残業・
 * 休日出勤・打刻修正の段階承認は製品の画面から動かせなかった。
 *
 * ここでは 2 段の経路を設定の画面で作り、従業員が出し、1 段目と 2 段目を
 * 別々の相手が決裁するところまでを通す。
 */

const RUN = `${Date.now() % 100000}`;
const TYPE_CODE = `REQ${RUN}`;

/**
 * 対象日は、いまから数日前にする。
 *
 * 自分の申請の一覧は直近 3 か月を見る。固定の日付を書くと、時が経つにつれて
 * 範囲の外へ出て、出したはずの申請が並ばなくなる。
 */
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const BUSINESS_DATE = daysAgo(3);

function card(page: Page) {
  return page.locator('.admin-content section.card');
}

function requestCenter(page: Page) {
  return page.locator('section[aria-labelledby="request-center-heading"]');
}

function approvals(page: Page) {
  return page.locator('.card', { has: page.getByRole('heading', { name: '承認待ちの申請' }) });
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

test.describe('申請と段階承認', () => {
  test('2 段の経路を作り、出して、順に決裁する', async ({ page }) => {
    test.slow();

    // 管理者が、2 段の経路つきで申請種別を作る。
    await signIn(page, E2E_ADMIN_CONSOLE_ADMIN.email, E2E_ADMIN_CONSOLE_ADMIN.password);
    await page.goto('/#/admin/request/request-types');
    await card(page).getByLabel('コード').fill(TYPE_CODE);
    await card(page).getByLabel('名称').fill('検証用の残業');
    await card(page).getByLabel('区分').selectOption('overtime');
    await card(page).getByLabel('承認の段数').fill('2');
    await card(page).getByLabel('1 段目 承認者').selectOption('organization_manager');
    await card(page).getByLabel('2 段目 承認者').selectOption('workspace_admin');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();
    await expect(card(page).getByRole('status')).toHaveText('保存しました');

    // 従業員が申請を出す。種別が求める入力だけが出る。
    await signIn(page, E2E_REQUEST_EMPLOYEE.email, E2E_REQUEST_EMPLOYEE.password);
    await requestCenter(page).getByLabel('申請の種別').selectOption({ label: '検証用の残業' });
    await requestCenter(page).getByLabel('対象日').fill(BUSINESS_DATE);
    await requestCenter(page).getByLabel('理由').fill('対応のため');
    await requestCenter(page).getByRole('button', { name: '申請する' }).click();

    await expect(requestCenter(page).getByRole('status')).toHaveText('申請しました');
    await expect(requestCenter(page).locator('.request-list')).toContainText('決裁待ち');
    await expect(requestCenter(page).locator('.request-list')).toContainText('1 / 2 段目');

    // 1 段目は組織の管理者が決裁する。
    await signIn(page, E2E_REQUEST_MANAGER.email, E2E_REQUEST_MANAGER.password);
    await approvals(page)
      .locator('li', { hasText: BUSINESS_DATE })
      .getByRole('button', { name: '承認' })
      .click();
    // 1 段目を通したので、この相手の列からは消える。2 段目は別の相手の番。
    await expect(approvals(page).locator('li', { hasText: BUSINESS_DATE })).toHaveCount(0);

    // 2 段目はワークスペースの管理者が決裁する。
    await signIn(page, E2E_ADMIN_CONSOLE_ADMIN.email, E2E_ADMIN_CONSOLE_ADMIN.password);
    await approvals(page)
      .locator('li', { hasText: BUSINESS_DATE })
      .getByRole('button', { name: '承認' })
      .click();

    // 申請した本人の画面で、承認済みと決裁の履歴が見える。
    await signIn(page, E2E_REQUEST_EMPLOYEE.email, E2E_REQUEST_EMPLOYEE.password);
    const row = requestCenter(page).locator('.request-list > li', { hasText: BUSINESS_DATE });
    await expect(row).toContainText('承認済み');
    await expect(row).toContainText('1 段目（1 回目）: 承認');
    await expect(row).toContainText('2 段目（1 回目）: 承認');
  });

  test('差し戻したあとに出し直せる', async ({ page }) => {
    test.slow();
    const code = `RET${RUN}`;
    const date = daysAgo(4);

    await signIn(page, E2E_ADMIN_CONSOLE_ADMIN.email, E2E_ADMIN_CONSOLE_ADMIN.password);
    await page.goto('/#/admin/request/request-types');
    await card(page).getByLabel('コード').fill(code);
    await card(page).getByLabel('名称').fill('差し戻しの検証');
    await card(page).getByLabel('区分').selectOption('other');
    await card(page).getByLabel('承認の段数').fill('1');
    await card(page).getByLabel('1 段目 承認者').selectOption('workspace_admin');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();
    await expect(card(page).getByRole('status')).toHaveText('保存しました');

    await signIn(page, E2E_REQUEST_EMPLOYEE.email, E2E_REQUEST_EMPLOYEE.password);
    await requestCenter(page).getByLabel('申請の種別').selectOption({ label: '差し戻しの検証' });
    await requestCenter(page).getByLabel('対象日').fill(date);
    await requestCenter(page).getByLabel('理由').fill('確認のため');
    await requestCenter(page).getByRole('button', { name: '申請する' }).click();
    await expect(requestCenter(page).getByRole('status')).toHaveText('申請しました');

    // 差し戻しには理由が要る。
    await signIn(page, E2E_ADMIN_CONSOLE_ADMIN.email, E2E_ADMIN_CONSOLE_ADMIN.password);
    await approvals(page)
      .locator('li', { hasText: date })
      .getByRole('button', { name: '差し戻し' })
      .click();
    await approvals(page).getByLabel('差し戻しの理由').fill('内容を直してください');
    await approvals(page).locator('form').getByRole('button', { name: '差し戻し' }).click();

    // 本人の画面から出し直す。1 段目からやり直す。
    await signIn(page, E2E_REQUEST_EMPLOYEE.email, E2E_REQUEST_EMPLOYEE.password);
    const row = requestCenter(page).locator('.request-list > li', { hasText: date });
    await expect(row).toContainText('差し戻し');
    await row.getByRole('button', { name: '出し直す' }).click();

    await expect(requestCenter(page).getByRole('status')).toHaveText('出し直しました');
    await expect(
      requestCenter(page).locator('.request-list > li', { hasText: date }),
    ).toContainText('2 回目の提出');
  });

  test('決裁を待っている申請は取り下げられる', async ({ page }) => {
    test.slow();
    const code = `CAN${RUN}`;
    const date = daysAgo(5);

    await signIn(page, E2E_ADMIN_CONSOLE_ADMIN.email, E2E_ADMIN_CONSOLE_ADMIN.password);
    await page.goto('/#/admin/request/request-types');
    await card(page).getByLabel('コード').fill(code);
    await card(page).getByLabel('名称').fill('取り下げの検証');
    await card(page).getByLabel('区分').selectOption('other');
    await card(page).getByLabel('承認の段数').fill('1');
    await card(page).getByLabel('1 段目 承認者').selectOption('workspace_admin');
    await card(page).getByRole('button', { name: '保存', exact: true }).click();
    await expect(card(page).getByRole('status')).toHaveText('保存しました');

    await signIn(page, E2E_REQUEST_EMPLOYEE.email, E2E_REQUEST_EMPLOYEE.password);
    await requestCenter(page).getByLabel('申請の種別').selectOption({ label: '取り下げの検証' });
    await requestCenter(page).getByLabel('対象日').fill(date);
    await requestCenter(page).getByLabel('理由').fill('やはり不要');
    await requestCenter(page).getByRole('button', { name: '申請する' }).click();
    await expect(requestCenter(page).getByRole('status')).toHaveText('申請しました');

    const row = requestCenter(page).locator('.request-list > li', { hasText: date });
    await row.getByRole('button', { name: '取り下げる' }).click();

    await expect(requestCenter(page).getByRole('status')).toHaveText('取り下げました');
    await expect(
      requestCenter(page).locator('.request-list > li', { hasText: date }),
    ).toContainText('取り下げ');
  });
});
