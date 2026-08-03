import { describe, expect, it } from 'vitest';
import {
  DEVICE_BROWSER_VALUES,
  DEVICE_KIND_VALUES,
  DEVICE_OS_VALUES,
  isDeviceBrowser,
  isDeviceKind,
  isDeviceOs,
  summarizeUserAgent,
} from './user-agent.js';

/**
 * 実在の名乗り。判別の順序を間違えると、Chrome を名乗る派生がすべて chrome になり、
 * Android と ChromeOS が linux になる。実物を並べて、その形を止める。
 */
const AGENTS = {
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  macFirefox:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 15; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  chromebook:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0',
  windowsOpera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
};

describe('summarizeUserAgent', () => {
  it.each([
    ['windowsChrome', { os: 'windows', browser: 'chrome', kind: 'desktop' }],
    ['windowsEdge', { os: 'windows', browser: 'edge', kind: 'desktop' }],
    ['windowsOpera', { os: 'windows', browser: 'opera', kind: 'desktop' }],
    ['macSafari', { os: 'macos', browser: 'safari', kind: 'desktop' }],
    ['macFirefox', { os: 'macos', browser: 'firefox', kind: 'desktop' }],
    ['iphoneSafari', { os: 'ios', browser: 'safari', kind: 'mobile' }],
    ['iphoneChrome', { os: 'ios', browser: 'chrome', kind: 'mobile' }],
    ['ipadSafari', { os: 'ipados', browser: 'safari', kind: 'tablet' }],
    ['androidPhone', { os: 'android', browser: 'chrome', kind: 'mobile' }],
    ['androidTablet', { os: 'android', browser: 'chrome', kind: 'tablet' }],
    ['androidSamsung', { os: 'android', browser: 'samsung', kind: 'mobile' }],
    ['chromebook', { os: 'chromeos', browser: 'chrome', kind: 'desktop' }],
    ['linuxFirefox', { os: 'linux', browser: 'firefox', kind: 'desktop' }],
  ] as const)('%s を系統へ落とす', (name, expected) => {
    expect(summarizeUserAgent(AGENTS[name])).toEqual(expected);
  });

  it('版番号も端末の型番も残さない', () => {
    const summary = summarizeUserAgent(AGENTS.androidSamsung);
    expect(JSON.stringify(summary)).not.toMatch(/\d/);
    expect(JSON.stringify(summary)).not.toContain('SM-');
  });

  it('名乗りが無ければ端末情報なしとして扱う', () => {
    expect(summarizeUserAgent(undefined)).toBeNull();
    expect(summarizeUserAgent(null)).toBeNull();
    expect(summarizeUserAgent('')).toBeNull();
    expect(summarizeUserAgent('   ')).toBeNull();
  });

  it('何も判別できない名乗りは端末情報なしとして扱う', () => {
    expect(summarizeUserAgent('curl/8.7.1')).toBeNull();
    expect(summarizeUserAgent('unknown-client')).toBeNull();
  });

  it('片方だけ判別できたら、判別できた側だけを残す', () => {
    // ブラウザだけを名乗る形。OS が分からないことを理由に、丸ごと捨てない。
    expect(summarizeUserAgent('Firefox/134.0')).toEqual({
      os: null,
      browser: 'firefox',
      kind: null,
    });
  });

  it('長い名乗りでも走査する量を増やさない', () => {
    // 先頭に本物、後ろに大量の詰め物。上限より先は見ない。
    const padded = `${AGENTS.windowsChrome}${'x'.repeat(100_000)}`;
    expect(summarizeUserAgent(padded)).toEqual({
      os: 'windows',
      browser: 'chrome',
      kind: 'desktop',
    });
  });

  it('上限より後ろにある名乗りは読まない', () => {
    const hidden = `${'x'.repeat(1_000)}${AGENTS.windowsChrome}`;
    expect(summarizeUserAgent(hidden)).toBeNull();
  });

  it('判別した値は、保存してよい系統の一覧に収まる', () => {
    for (const raw of Object.values(AGENTS)) {
      const summary = summarizeUserAgent(raw);
      expect(summary).not.toBeNull();
      if (summary === null) continue;
      if (summary.os !== null) expect(DEVICE_OS_VALUES).toContain(summary.os);
      if (summary.browser !== null) expect(DEVICE_BROWSER_VALUES).toContain(summary.browser);
      if (summary.kind !== null) expect(DEVICE_KIND_VALUES).toContain(summary.kind);
    }
  });
});

describe('系統の判定', () => {
  it('一覧にある値だけを受け入れる', () => {
    expect(isDeviceOs('macos')).toBe(true);
    expect(isDeviceOs('MacOS')).toBe(false);
    expect(isDeviceBrowser('safari')).toBe(true);
    expect(isDeviceBrowser('lynx')).toBe(false);
    expect(isDeviceKind('tablet')).toBe(true);
    expect(isDeviceKind('watch')).toBe(false);
  });
});
