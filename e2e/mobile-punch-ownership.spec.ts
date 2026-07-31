import type { APIResponse, Page, Route } from '@playwright/test';
import { devices, expect, test } from '@playwright/test';
import type { PunchQueueOwner } from '../packages/web/src/offline/punch-queue.ts';
import { storageKeyOf } from '../packages/web/src/offline/punch-queue.ts';
import type { SeededAccount } from './setup/prepare-database.js';
import {
  E2E_PENDING_PUNCH_EMPLOYEE,
  E2E_PUNCH_BYSTANDER_EMPLOYEE,
  E2E_PUNCH_OWNER_EMPLOYEE,
  E2E_STALE_DAY_EMPLOYEE,
  E2E_STORAGE_FAILURE_EMPLOYEE,
  E2E_STORAGE_READ_EMPLOYEE,
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

async function selectLocale(page: Page, locale: 'ja-JP' | 'en'): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/preferences') && response.request().method() === 'PATCH',
  );
  await page.locator('.locale-switcher select').selectOption(locale);
  await saved;
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

/** 送信待ち打刻を端末へ用意する。保存形式は画面と同じ実装で組み立てる。 */
async function seedPendingPunch(
  page: Page,
  owner: PunchQueueOwner,
  requestId: string,
): Promise<void> {
  await page.evaluate(
    ([key, stored]) => window.localStorage.setItem(key ?? '', stored ?? ''),
    [
      storageKeyOf(owner),
      JSON.stringify({
        schemaVersion: 2,
        owner,
        entries: [
          { requestId, eventType: 'clock_in', occurredAt: new Date().toISOString(), attempts: 1 },
        ],
      }),
    ],
  );
}

/** React の描画が落ち着くまで待つ。時間ではなく描画の回数で区切る。 */
async function settleRendering(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
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
    await seedPendingPunch(page, owner, requestId);

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

  test('遅れて届いた古い勤務日で打刻の表示を巻き戻さない', async ({ page }) => {
    await signIn(page, E2E_STALE_DAY_EMPLOYEE);
    const owner = await ownerOf(page);
    await signOut(page);

    await seedPendingPunch(page, owner, 'e2e-stale-day-clock-in');

    // 最初の読み込みだけを保留し、後から始まった読み込みを先に返す。
    // 応答の内容は保留した時点で確保する。後で取りに行くと、打刻後の勤務日になってしまう。
    let held: { route: Route; response: APIResponse } | null = null;
    let reads = 0;
    await page.route('**/api/attendance/today', async (route) => {
      reads += 1;
      if (reads === 1) {
        held = { route, response: await route.fetch() };
        return;
      }
      await route.continue();
    });

    await fillSignIn(page, E2E_STALE_DAY_EMPLOYEE);

    // 保存済みの打刻が送られ、画面へ反映される。
    await expect(page.locator('.work-state')).toHaveText('勤務中');
    await expect(page.locator('.punch-events li')).toHaveCount(1);

    // ここで、打刻より前に確保した勤務日が返る。
    expect(held).not.toBeNull();
    const stale = page.waitForResponse((response) =>
      response.url().includes('/api/attendance/today'),
    );
    const pendingRead = held as unknown as { route: Route; response: APIResponse };
    await pendingRead.route.fulfill({ response: pendingRead.response });
    await stale;
    await settleRendering(page);

    // 古い勤務日には打刻が入っていないが、画面は戻らない。
    await expect(page.locator('.work-state')).toHaveText('勤務中');
    await expect(page.locator('.punch-events li')).toHaveCount(1);
  });

  test('英語の画面では停止の理由も英語で出す', async ({ page }) => {
    await signIn(page, E2E_PUNCH_BYSTANDER_EMPLOYEE);
    await selectLocale(page, 'en');

    const serverMessage = 'この操作を行う権限がありません';
    await page.route('**/api/attendance/events', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'forbidden', message: serverMessage } }),
      }),
    );

    await page.getByRole('button', { name: 'Clock in', exact: true }).click();

    const blocked = page.locator('.blocked-banner');
    await expect(blocked).toContainText('Check your permissions');
    // サーバーの文言は日本語のままなので、そのまま画面へ出さない。
    await expect(blocked).not.toContainText(serverMessage);

    await expect(page.locator('.pending-banner')).toContainText('waiting to be sent');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

    // 表示言語は利用者設定として保存されるため、後続のテストのために戻す。
    await page.unroute('**/api/attendance/events');
    await selectLocale(page, 'ja-JP');
  });

  test('端末に保存できない打刻は受理せず、API へも送らない', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/attendance/events')) {
        sent.push(request.url());
      }
    });

    await signIn(page, E2E_STORAGE_FAILURE_EMPLOYEE);
    const owner = await ownerOf(page);

    // 送信待ち打刻の保存先だけを失敗させる。保存先の名前は画面と同じ実装で組み立てる。
    await page.addInitScript((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(name: string, value: string) {
        if (name === key) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return original.call(this, name, value);
      };
    }, storageKeyOf(owner));
    await page.reload();
    await expect(page.locator('.work-state')).toHaveText('出勤前');

    await page.getByRole('button', { name: '出勤', exact: true }).click();

    const blocked = page.locator('.blocked-banner');
    await expect(blocked).toContainText('打刻は記録されていません');
    // 保存できていない打刻を、送信待ちとして見せない。
    await expect(page.locator('.pending-banner')).toHaveCount(0);
    await expect(page.locator('.work-state')).toHaveText('出勤前');
    expect(sent).toHaveLength(0);
    // 例外の中身は利用者の役に立たないため、画面へ出さない。
    await expect(blocked).not.toContainText('Quota');

    await selectLocale(page, 'en');
    await expect(page.locator('.blocked-banner')).toContainText('was not recorded');

    await selectLocale(page, 'ja-JP');
  });

  test('読み込み障害から復旧すれば、同じ画面のまま打刻できる', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/attendance/events')) {
        sent.push(request.url());
      }
    });

    await signIn(page, E2E_STORAGE_READ_EMPLOYEE);
    const owner = await ownerOf(page);
    await signOut(page);

    // 送信待ち打刻の保存先だけを読めなくする。合図を送るまで解除しない。
    await page.addInitScript((key) => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function getItem(name: string) {
        const recovered = (window as unknown as { punchStorageRecovered?: boolean })
          .punchStorageRecovered;
        if (name === key && recovered !== true) {
          throw new DOMException('Storage is not available', 'SecurityError');
        }
        return original.call(this, name);
      };
    }, storageKeyOf(owner));
    await page.reload();
    await fillSignIn(page, E2E_STORAGE_READ_EMPLOYEE);

    await expect(page.locator('.blocked-banner')).toContainText('打刻は記録されていません');
    expect(sent).toHaveLength(0);

    // 保存設定が直った状況を作る。画面は再読み込みしない。
    await page.evaluate(() => {
      (window as unknown as { punchStorageRecovered: boolean }).punchStorageRecovered = true;
    });

    await page.getByRole('button', { name: '出勤', exact: true }).click();

    // 画面が案内するとおり、再操作だけで送信まで進む。
    await expect(page.locator('.work-state')).toHaveText('勤務中');
    await expect(page.locator('.blocked-banner')).toHaveCount(0);
    expect(sent).toHaveLength(1);

    await page.reload();
    await expect(page.locator('.punch-events li')).toHaveCount(1);
  });
});
