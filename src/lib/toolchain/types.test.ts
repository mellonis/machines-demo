import { describe, expect, it } from 'vitest';
import { ENGINES, isJsEngine, isToolchainEngine } from '../types.ts';
import { readEngineFromLandingQuery, readRouteFromUrl } from '../routing.ts';
import { kindOfLang, langFor, TOOLCHAIN_ARCH } from './types.ts';

describe('toolchain engine ids', () => {
  it('T-engines-four: ENGINES lists the two JS engines then the two toolchain engines', () => {
    expect(ENGINES).toEqual(['turing', 'post', 'pm1', 'tm1']);
    expect(isToolchainEngine('pm1')).toBe(true);
    expect(isToolchainEngine('turing')).toBe(false);
    expect(isJsEngine('post')).toBe(true);
    expect(isJsEngine('tm1')).toBe(false);
  });

  it('T-engines-route: /pm1 and /tm1 are engine routes', () => {
    expect(readRouteFromUrl('/pm1')).toEqual({ kind: 'engine', engine: 'pm1' });
    expect(readRouteFromUrl('/tm1')).toEqual({ kind: 'engine', engine: 'tm1' });
  });

  it('T-engines-landing-query: the landing query only knows the JS engines this round', () => {
    expect(readEngineFromLandingQuery('?engine=post')).toBe('post');
    expect(readEngineFromLandingQuery('?engine=pm1')).toBe('turing');
  });

  it('T-lang-for: arch × kind gives the four languages', () => {
    expect(TOOLCHAIN_ARCH).toEqual({ pm1: 'pm', tm1: 'tm' });
    expect(langFor('pm1', 'source')).toBe('pmc');
    expect(langFor('pm1', 'asm')).toBe('pma');
    expect(langFor('tm1', 'source')).toBe('tmc');
    expect(langFor('tm1', 'asm')).toBe('tma');
    expect(kindOfLang('tmc')).toBe('source');
    expect(kindOfLang('pma')).toBe('asm');
  });
});
