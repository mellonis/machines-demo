// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { LOG_RENDER_CAP, MAX_STEPS, WORKER_TIMEOUT_MS } from './caps.ts';
import {
  SETTING_SPECS,
  getSetting,
  parseSettingValue,
  resetSetting,
  setSetting,
  type SettingKey,
} from './settings.ts';

const KEYS: SettingKey[] = ['maxSteps', 'workerTimeoutMs', 'logRenderCap'];

describe('settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('defaults', () => {
    it('S-settings-default: getSetting returns the caps.ts default when nothing is stored', () => {
      expect(getSetting('maxSteps')).toBe(MAX_STEPS);
      expect(getSetting('workerTimeoutMs')).toBe(WORKER_TIMEOUT_MS);
      expect(getSetting('logRenderCap')).toBe(LOG_RENDER_CAP);
    });

    it('S-settings-spec-defaults: SETTING_SPECS defaults mirror caps.ts', () => {
      expect(SETTING_SPECS.maxSteps.default).toBe(MAX_STEPS);
      expect(SETTING_SPECS.workerTimeoutMs.default).toBe(WORKER_TIMEOUT_MS);
      expect(SETTING_SPECS.logRenderCap.default).toBe(LOG_RENDER_CAP);
    });

    it('S-settings-spec-bounds: every spec has integer min < default < max', () => {
      for (const key of KEYS) {
        const spec = SETTING_SPECS[key];
        expect(Number.isInteger(spec.min)).toBe(true);
        expect(Number.isInteger(spec.max)).toBe(true);
        expect(spec.min).toBeLessThan(spec.default);
        expect(spec.default).toBeLessThan(spec.max);
      }
    });
  });

  describe('write-through', () => {
    it('S-settings-roundtrip: setSetting persists under machines-demo:settings:<key> and getSetting returns it', () => {
      expect(setSetting('maxSteps', 500)).toBe(true);
      expect(getSetting('maxSteps')).toBe(500);
      expect(localStorage.getItem('machines-demo:settings:maxSteps')).toBe('500');
    });

    it('S-settings-set-rejects-out-of-range: setSetting outside [min, max] returns false and persists nothing', () => {
      expect(setSetting('workerTimeoutMs', SETTING_SPECS.workerTimeoutMs.min - 1)).toBe(false);
      expect(setSetting('workerTimeoutMs', SETTING_SPECS.workerTimeoutMs.max + 1)).toBe(false);
      expect(localStorage.getItem('machines-demo:settings:workerTimeoutMs')).toBe(null);
      expect(getSetting('workerTimeoutMs')).toBe(WORKER_TIMEOUT_MS);
    });

    it('S-settings-set-rejects-non-integer: setSetting with a fractional or non-finite value returns false', () => {
      expect(setSetting('logRenderCap', 500.5)).toBe(false);
      expect(setSetting('logRenderCap', NaN)).toBe(false);
      expect(setSetting('logRenderCap', Infinity)).toBe(false);
      expect(localStorage.getItem('machines-demo:settings:logRenderCap')).toBe(null);
    });
  });

  describe('invalid stored values fall back to the default (no clamping)', () => {
    it('S-settings-stored-garbage: non-numeric stored string → default', () => {
      localStorage.setItem('machines-demo:settings:maxSteps', 'abc');
      expect(getSetting('maxSteps')).toBe(MAX_STEPS);
    });

    it('S-settings-stored-fractional: fractional stored string → default', () => {
      localStorage.setItem('machines-demo:settings:maxSteps', '12.5');
      expect(getSetting('maxSteps')).toBe(MAX_STEPS);
    });

    it('S-settings-stored-out-of-range: below min or above max → default, not clamped', () => {
      localStorage.setItem(
        'machines-demo:settings:logRenderCap',
        String(SETTING_SPECS.logRenderCap.min - 1),
      );
      expect(getSetting('logRenderCap')).toBe(LOG_RENDER_CAP);
      localStorage.setItem(
        'machines-demo:settings:logRenderCap',
        String(SETTING_SPECS.logRenderCap.max + 1),
      );
      expect(getSetting('logRenderCap')).toBe(LOG_RENDER_CAP);
    });
  });

  describe('reset', () => {
    it('S-settings-reset: resetSetting removes the stored key and getSetting returns the default again', () => {
      setSetting('maxSteps', 500);
      resetSetting('maxSteps');
      expect(localStorage.getItem('machines-demo:settings:maxSteps')).toBe(null);
      expect(getSetting('maxSteps')).toBe(MAX_STEPS);
    });
  });

  describe('Infinity (maxSteps only — run bounded by the wall-clock timeout alone)', () => {
    it('S-settings-infinity-roundtrip: setSetting(maxSteps, Infinity) persists "Infinity" and reads back Infinity', () => {
      expect(setSetting('maxSteps', Infinity)).toBe(true);
      expect(localStorage.getItem('machines-demo:settings:maxSteps')).toBe('Infinity');
      expect(getSetting('maxSteps')).toBe(Infinity);
    });

    it('S-settings-infinity-parse: "Infinity" (any case) and "∞" parse to Infinity for maxSteps', () => {
      expect(parseSettingValue('maxSteps', 'Infinity')).toBe(Infinity);
      expect(parseSettingValue('maxSteps', 'infinity')).toBe(Infinity);
      expect(parseSettingValue('maxSteps', '∞')).toBe(Infinity);
    });

    it('S-settings-infinity-rejected-elsewhere: workerTimeoutMs and logRenderCap refuse Infinity', () => {
      expect(setSetting('workerTimeoutMs', Infinity)).toBe(false);
      expect(parseSettingValue('workerTimeoutMs', 'Infinity')).toBe(null);
      expect(parseSettingValue('logRenderCap', '∞')).toBe(null);
    });
  });

  describe('parseSettingValue', () => {
    it('S-settings-parse-valid: a plain in-range integer string parses to its number', () => {
      expect(parseSettingValue('maxSteps', '500')).toBe(500);
      expect(parseSettingValue('maxSteps', '  500  ')).toBe(500);
    });

    it('S-settings-parse-invalid: empty, non-integer, signed, exponent, and out-of-range inputs → null', () => {
      expect(parseSettingValue('maxSteps', '')).toBe(null);
      expect(parseSettingValue('maxSteps', 'abc')).toBe(null);
      expect(parseSettingValue('maxSteps', '12.5')).toBe(null);
      expect(parseSettingValue('maxSteps', '-500')).toBe(null);
      expect(parseSettingValue('maxSteps', '1e3')).toBe(null);
      expect(parseSettingValue('maxSteps', String(SETTING_SPECS.maxSteps.min - 1))).toBe(null);
      expect(parseSettingValue('maxSteps', String(SETTING_SPECS.maxSteps.max + 1))).toBe(null);
    });
  });
});
