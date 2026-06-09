import { describe, it, expect } from 'vitest';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { getSchema } from '../schema/index.ts';
import { scanLocals } from './locals.ts';

const parse = (src: string) => javascriptLanguage.parser.parse(src);

const schema = getSchema('turing');

const scan = (src: string) => scanLocals(src, parse(src).topNode, schema);

describe('scanner — Phase 1 rules', () => {
  it('S-scan-newexpr-state', () => {
    const r = scan('const x = new State({});');
    expect(r.locals.get('x')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-newexpr-unknown — ignored', () => {
    const r = scan('const z = new Foo();');
    expect(r.locals.has('z')).toBe(false);
  });

  it('S-scan-import-haltState-via-member', () => {
    const r = scan('const h = imports.haltState;');
    expect(r.locals.get('h')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-import-haltState-via-bare', () => {
    const r = scan('const { haltState } = imports;\nconst h = haltState;');
    expect(r.locals.get('h')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-destructure-imports-flat', () => {
    const r = scan('const { State, Tape } = imports;');
    expect(r.importsBinding.kind).toBe('present');
    if (r.importsBinding.kind !== 'present') return;
    expect(r.importsBinding.boundNames).toEqual(new Set(['State', 'Tape']));
    expect(r.importsBinding.isMultiLine).toBe(false);
  });

  it('S-scan-destructure-imports-multiline', () => {
    const src = `const {\n  State,\n  Tape,\n} = imports;`;
    const r = scan(src);
    expect(r.importsBinding.kind).toBe('present');
    if (r.importsBinding.kind !== 'present') return;
    expect(r.importsBinding.isMultiLine).toBe(true);
  });

  it('S-scan-destructure-rename', () => {
    const r = scan('const { State: TS } = imports;');
    expect(r.importsBinding.kind).toBe('present');
    if (r.importsBinding.kind !== 'present') return;
    expect(r.importsBinding.boundNames).toEqual(new Set(['State']));
    expect(r.importsBinding.renames.get('State')).toBe('TS');
    expect(r.locals.get('TS')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-importsBinding-absent', () => {
    const r = scan('const x = 1;');
    expect(r.importsBinding.kind).toBe('absent');
  });

  it('S-scan-importsBinding-first-wins', () => {
    const r = scan('const { State } = imports;\nconst { Tape } = imports;');
    expect(r.importsBinding.kind).toBe('present');
    if (r.importsBinding.kind !== 'present') return;
    expect(r.importsBinding.boundNames).toEqual(new Set(['State', 'Tape']));
  });

  it('S-scan-incomplete-tree — does not throw', () => {
    expect(() => scan('const x = new State(')).not.toThrow();
    const r = scan('const x = new State(');
    expect(r.importsBinding.kind).toBe('absent');
  });
});

describe('scanner — Phase 2 rules', () => {
  it('S-scan-newexpr-tape', () => {
    const r = scan('const t = new Tape({ alphabet });');
    expect(r.locals.get('t')).toEqual({ kind: 'class', name: 'Tape' });
  });

  it('S-scan-newexpr-tapeblock', () => {
    const r = scan('const tb = new TapeBlock({ tapes: [] });');
    expect(r.locals.get('tb')).toEqual({ kind: 'class', name: 'TapeBlock' });
  });

  it('S-scan-wohs-return', () => {
    const r = scan('const w = a.withOverriddenHaltState(b);');
    expect(r.locals.get('w')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-tag-return', () => {
    const r = scan('const x = s.tag(["k"]);');
    expect(r.locals.get('x')).toEqual({ kind: 'class', name: 'State' });
  });

  it('S-scan-static-fromTapes', () => {
    const r = scan('const tb = TapeBlock.fromTapes([t]);');
    expect(r.locals.get('tb')).toEqual({ kind: 'class', name: 'TapeBlock' });
  });

  it('S-scan-destructure-tapeblock-symbol', () => {
    const r = scan('const tb = new TapeBlock({ tapes: [] });\nconst { symbol } = tb;');
    expect(r.locals.get('symbol')).toEqual({ kind: 'function', signatureRef: 'TapeBlock.symbol' });
  });
});
