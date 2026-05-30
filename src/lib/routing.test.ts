import { describe, it, expect } from 'vitest';
import { readRouteFromUrl, readEngineFromLandingQuery, legacyMachineRewrite } from './routing';

describe('routing helpers', () => {
  it('R-route-landing-from-root', () => {
    expect(readRouteFromUrl('/')).toEqual({ kind: 'landing' });
  });
  it('R-route-landing-from-unknown', () => {
    expect(readRouteFromUrl('/foo')).toEqual({ kind: 'landing' });
  });
  it('R-route-engine-turing', () => {
    expect(readRouteFromUrl('/turing')).toEqual({ kind: 'engine', engine: 'turing' });
  });
  it('R-route-engine-post', () => {
    expect(readRouteFromUrl('/post')).toEqual({ kind: 'engine', engine: 'post' });
  });
  it('R-route-landing-engine-query — defaults to turing', () => {
    expect(readEngineFromLandingQuery('')).toBe('turing');
    expect(readEngineFromLandingQuery('?engine=post')).toBe('post');
    expect(readEngineFromLandingQuery('?engine=bogus')).toBe('turing');
  });
  it('R-route-legacy-machine-rewrite', () => {
    const url = legacyMachineRewrite(new URL('http://x.test/?machine=post'));
    expect(url.pathname).toBe('/post');
    expect(url.searchParams.has('machine')).toBe(false);
  });
});
