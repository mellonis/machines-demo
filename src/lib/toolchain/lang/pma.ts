// PM-1 `.pma` assembly. Ported from the toolchains' editors/grammars/pma.tmLanguage.json;
// the mnemonic alternation is longest-first so `jm.s` is never shadowed by `jm`.
import type { StreamParser } from '@codemirror/language';
import { QUALIFIED, IDENT, tokenTable } from './tokens.ts';

const MNEMONICS = /^(?:call\.s|jmp\.s|jnm\.s|call|jm\.s|nop|stp|hlt|lft|rgt|jmp|jnm|ret|ent|brk|wrl|wrr|wr|jm)\b/;

type AState = { afterFunc: boolean };

export const pmaParser: StreamParser<AState> = {
  name: 'pma',
  startState: () => ({ afterFunc: false }),
  tokenTable,
  token(stream, state) {
    if (stream.sol()) {
      state.afterFunc = false;
      if (stream.match(/^[ \t]*[A-Za-z_][A-Za-z0-9_]*:/)) return 'label';
    }
    if (stream.eatSpace()) return null;
    if (stream.match(';')) { stream.skipToEnd(); return 'cmt'; }
    if (stream.match(/^\.func\b/)) { state.afterFunc = true; return 'directive'; }
    if (stream.match(/^\.(?:byte|volatile)\b/)) return 'directive';
    if (state.afterFunc) {
      if (stream.match(/^local\b/)) return 'kw';
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_.:]*/)) return 'fn';
    }
    if (stream.match(MNEMONICS)) return 'kw';
    if (stream.match(QUALIFIED)) return 'fn';
    if (stream.match(/^@[A-Za-z_][\w.:]*/)) return 'sym';
    if (stream.match(/^-?\d+/)) return 'num';
    if (stream.match(IDENT)) return 'sym';
    stream.next();
    return null;
  },
};
