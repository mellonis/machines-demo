import { describe, expect, it } from 'vitest';
import { pmaParser, pmcParser, tmaParser, tmcParser, tokenizeLine, toolchainLanguage } from './index.ts';

const styles = (parser: Parameters<typeof tokenizeLine>[0], line: string) =>
  tokenizeLine(parser, line).filter(([, s]) => s !== null).map(([t, s]) => `${s}:${t}`);

describe('pmc', () => {
  it('T-lang-pmc-call: keywords, labels, calls, namespaces and the return bang', () => {
    expect(styles(pmcParser, '    1: @std::goToEnd(!);')).toEqual(['label:1:', 'fn:@std::goToEnd', 'op:!']);
    expect(styles(pmcParser, 'use std::goToEnd, std::goToBegin;')).toEqual(['kw:use', 'ns:std::', 'sym:goToEnd', 'ns:std::', 'sym:goToBegin']);
    expect(styles(pmcParser, 'export helper() {')).toEqual(['kw:export', 'fn:helper']);
    expect(styles(pmcParser, '    check(1, 3);')).toEqual(['kw:check', 'num:1', 'num:3']);
  });
  it('T-lang-pmc-comments: line and block comments, block spanning lines', () => {
    expect(styles(pmcParser, 'mark; // to the end')).toEqual(['kw:mark', 'cmt:// to the end']);
    const state = pmcParser.startState!(2);
    expect(tokenizeLine(pmcParser, '/* open', state).map(([, s]) => s)).toEqual(['cmt']);
    expect(tokenizeLine(pmcParser, 'still */ right;', state).map(([, s]) => s)).toEqual(['cmt', null, 'kw', null]);
  });
});

describe('tmc', () => {
  it('T-lang-tmc-rule: glyphs, rule arrow, wildcard, moves, keywords', () => {
    expect(styles(tmcParser, "    ['0'..'1' as c, *] -> write [-, {c}] move [>, >] goto copy;")).toEqual([
      'glyph:\'0\'', 'op:..', 'glyph:\'1\'', 'kw:as', 'sym:c', 'wild:*', 'op:->', 'kw:write', 'move:-', 'sym:c', 'kw:move', 'move:>', 'move:>', 'kw:goto', 'sym:copy',
    ]);
  });
  it('T-lang-tmc-decl: declaring keywords color the introduced name as a type', () => {
    expect(styles(tmcParser, "alphabet bits { '_', '0', '1' }")).toEqual(['kw:alphabet', 'type:bits', 'glyph:\'_\'', 'glyph:\'0\'', 'glyph:\'1\'']);
    expect(styles(tmcParser, '  entry state inc {')).toEqual(['kw:entry', 'kw:state', 'type:inc']);
    expect(styles(tmcParser, '? Corrected 2^n (unary)')).toEqual(['doc:? Corrected 2^n (unary)']);
    expect(styles(tmcParser, '! [deprecated] use foo')).toEqual(['cmt:! [deprecated] use foo']);
  });
});

describe('pma', () => {
  it('T-lang-pma: directives, labels, mnemonics, numbers, symbols, comments', () => {
    expect(styles(pmaParser, '.func main local')).toEqual(['directive:.func', 'fn:main', 'kw:local']);
    expect(styles(pmaParser, 'L1:     rgt')).toEqual(['label:L1:', 'kw:rgt']);
    expect(styles(pmaParser, '        jm      L1 ; loop')).toEqual(['kw:jm', 'sym:L1', 'cmt:; loop']);
    expect(styles(pmaParser, '        call    std::goToEnd')).toEqual(['kw:call', 'fn:std::goToEnd']);
    expect(styles(pmaParser, '        wr      1')).toEqual(['kw:wr', 'num:1']);
    expect(styles(pmaParser, '        .byte   -3 @sym.x')).toEqual(['directive:.byte', 'num:-3', 'sym:@sym.x']);
  });
});

describe('tma', () => {
  it('T-lang-tma: sections, tables, interpolation, hex, operators', () => {
    expect(styles(tmaParser, '.section text')).toEqual(['directive:.section', 'type:text']);
    expect(styles(tmaParser, '.rept v = 0x10')).toEqual(['directive:.rept', 'sym:v', 'op:=', 'num:0x10']);
    expect(styles(tmaParser, '        .row [*, {v}, *] -> Linc{v}')).toEqual(['directive:.row', 'wild:*', 'op:{v}', 'wild:*', 'op:->', 'sym:Linc', 'op:{v}']);
    expect(styles(tmaParser, '        call.m  std::goToNumber #2')).toEqual(['kw:call.m', 'fn:std::goToNumber', 'op:#', 'num:2']);
  });
  it('T-lang-tma-func-local: local keeps its keyword color after a .func name', () => {
    expect(styles(tmaParser, '.func main local')).toEqual(['directive:.func', 'fn:main', 'kw:local']);
  });
});

describe('LanguageSupport', () => {
  it('T-lang-support: each language builds a LanguageSupport once', () => {
    expect(toolchainLanguage('pmc')).toBe(toolchainLanguage('pmc'));
    expect(toolchainLanguage('tma').language.name).toBe('tma');
  });
});
