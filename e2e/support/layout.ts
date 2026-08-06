import type { Page } from '@playwright/test';

/**
 * 画面の外へはみ出している要素を探す。
 *
 * `scrollWidth - clientWidth` では測らない。縦の巻き取り棒がある画面では、
 * 棒の幅がそのまま差として出る。はみ出していなくても数十ピクセルの差が付き、
 * 「はみ出している」と誤って読める。
 *
 * 横に送れる入れ物（表など）の中身は数えない。中身は入れ物の中で送られるため、
 * 本文ごと横へ広がることはない。数えると、正しく囲った表まで違反として出る。
 *
 * 要素ごとに右端を見れば、はみ出しているかどうかだけでなく、
 * どの要素が原因かも分かる。直す側が探し直さずに済む。
 */
export async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;

    /** 横に送れる入れ物の中にあるか。あるなら、本文を広げることはない。 */
    const contained = (element: Element): boolean => {
      for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') return true;
      }
      return false;
    };

    return (
      [...document.querySelectorAll('body *')]
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        // 幅の無いものは並びに関わらない。読み上げ用に隠した要素などが該当する。
        .filter(({ box }) => box.width > 0 && box.right > limit + 1)
        .filter(({ element }) => !contained(element))
        .map(({ element, box }) => {
          const name =
            element.className === '' ? element.tagName : `${element.tagName}.${element.className}`;
          return `${name}（右端 ${Math.round(box.right)} / 画面 ${limit}）`;
        })
    );
  });
}
