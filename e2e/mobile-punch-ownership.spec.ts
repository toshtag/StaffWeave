import type { Page } from '@playwright/test';
import { devices, expect, test } from '@playwright/test';
import type { PunchQueueOwner } from '../packages/web/src/offline/punch-queue.ts';
import { storageKeyOf } from '../packages/web/src/offline/punch-queue.ts';
import type { SeededAccount } from './setup/prepare-database.js';
import {
  E2E_PENDING_PUNCH_EMPLOYEE,
  E2E_PUNCH_BYSTANDER_EMPLOYEE,
  E2E_PUNCH_OWNER_EMPLOYEE,
} from './setup/prepare-database.js';

/** 携帯電話の画面幅で確認する。 */
test.use({ ...devices['Pixel 5'] });

async function fillSignIn(page: Page, account: SeededAccount): Promise<void> {
  await page.getByLabel('メールアドレス').fill(account.email);
  await page.getByLabel('パスワード').fill(account.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

async function signIn(page: Page, account: SeededAccount): Promise<void> {
  await page.goto('/');
  await fillSignIn(page, account);
  await expect(page.locator('.work-state')).toBeVisible();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
}

/** 保存先の名前は画面と同じ実装で組み立て、テスト側に写しを作らない。 */
async function ownerOf(page: Page): Promise<PunchQueueOwner> {
  const response = await page.request.get('/api/auth/session');
  const session = (await response.json()) as {
    workspace: { id: string };
    user: { id: string };
    employee: { id: string };
  };
  return {
    workspaceId: session.workspace.id,
    userId: session.user.id,
    employeeId: session.employee.id,
  };
}

async function storedEntries(page: Page, owner: PunchQueueOwner): Promise<{ requestId: string }[]> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), storageKeyOf(owner));
  if (raw === null) return [];
  return (JSON.parse(raw) as { entries: { requestId: string }[] }).entries;
}

test.describe('送信待ち打刻の所有者', () => {
  test('セッションが切れても打刻を残し、同じ利用者の再ログインで送る', async ({ page }) => {
    await signIn(page, E2E_PENDING_PUNCH_EMPLOYEE);
    const owner = await ownerOf(page);

    // 打刻だけが認証切れになる状況を作る。セッションの照会は成功させたままにする。
    await page.route('**/api/attendance/events', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'unauthenticated', message: 'セッションの有効期限が切れました' },
        }),
      }),
    );

    await page.getByRole('button', { name: '出勤', exact: true }).click();

    // ログイン画面へ戻され、打刻が端末に残っていることが伝わる。
    await expect(page.locator('.session-expired-notice')).toBeVisible();
    await expect(page.locator('.session-expired-notice')).toContainText('この端末に残っています');

    const pending = await storedEntries(page, owner);
    expect(pending).toHaveLength(1);

    await page.unroute('**/api/attendance/events');
    await fillSignIn(page, E2E_PENDING_PUNCH_EMPLOYEE);

    // 画面を開いた時点の送り直しで、残っていた打刻が届く。
    await expect(page.locator('.work-state')).toHaveText('勤務中');
    await expect(page.locator('.pending-banner')).toHaveCount(0);
    expect(await storedEntries(page, owner)).toHaveLength(0);

    await page.reload();
    await expect(page.locator('.work-state')).toHaveText('勤務中');
    await expect(page.locator('.punch-events li')).toHaveCount(1);
  });

  test('別の利用者は端末に残った打刻を送らない', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/attendance/events')) {
        sent.push(request.postData() ?? '');
      }
    });

    await signIn(page, E2E_PUNCH_OWNER_EMPLOYEE);
    const owner = await ownerOf(page);
    await signOut(page);

    // 持ち主の送信待ち打刻を端末へ用意する。
    const requestId = 'e2e-punch-owner-clock-in';
    await page.evaluate(
      ([key, stored]) => window.localStorage.setItem(key ?? '', stored ?? ''),
      [
        storageKeyOf(owner),
        JSON.stringify({
          schemaVersion: 2,
          owner,
          entries: [
            {
              requestId,
              eventType: 'clock_in',
              occurredAt: new Date().toISOString(),
              attempts: 1,
            },
          ],
        }),
      ],
    );

    await fillSignIn(page, E2E_PUNCH_BYSTANDER_EMPLOYEE);
    await expect(page.locator('.work-state')).toHaveText('出勤前');

    // 別の利用者の画面には件数も出ず、勤怠にも足されない。
    await expect(page.locator('.pending-banner')).toHaveCount(0);
    await expect(page.locator('.punch-events li')).toHaveCount(0);
    expect(sent.some((body) => body.includes(requestId))).toBe(false);

    await signOut(page);
    await fillSignIn(page, E2E_PUNCH_OWNER_EMPLOYEE);

    // 持ち主が戻れば、自分の打刻だけが送られる。
    await expect(page.locator('.work-state')).toHaveText('勤務中');
    await expect(page.locator('.punch-events li')).toHaveCount(1);
    expect(sent.some((body) => body.includes(requestId))).toBe(true);
  });
});
