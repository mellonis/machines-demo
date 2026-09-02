// PM-1 `.pmc` source. Ported from the toolchains' editors/grammars/pmc.tmLanguage.json
// (keywords, commands, `@calls`, definitions, numeric labels, `::`, `!`).
import type { StreamParser, StringStream } from '@codemirror/language';
import { IDENT, tokenTable } from './tokens.ts';

export type CState = { inBlock: boolean; lineStart: boolean };

const KEYWORDS = /^(?:use|namespace|volatile|export|as|goto|check|halt|left|right|mark|unmark|debugger)\b/;

function blockComment(stream: StringStream, state: CState): string {
  if (stream.skipTo('*/')) { stream.match('*/'); state.inBlock = false; } else stream.skipToEnd();
  return 'cmt';
}

export const pmcParser: StreamParser<CState> = {
  name: 'pmc',
  startState: () => ({ inBlock: false, lineStart: true }),
  tokenTable,
  token(stream, state) {
    if (state.inBlock) return blockComment(stream, state);
    if (stream.sol()) state.lineStart = true;
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'cmt'; }
    if (stream.match('/*')) { state.inBlock = true; return blockComment(stream, state); }
    const atStatementStart = state.lineStart;
    state.lineStart = false;
    if (atStatementStart && stream.match(/^\d+\s*:/)) return 'label';
    if (stream.match(/^@\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*::\s*[A-Za-z_][A-Za-z0-9_]*)*/)) return 'fn';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*::/)) return 'ns';
    if (stream.match(KEYWORDS)) return 'kw';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*(?=\s*\(\s*\)\s*\{)/)) return 'fn';
    if (stream.match(IDENT)) return 'sym';
    if (stream.match(/^\d+/)) return 'num';
    if (stream.match('!')) return 'op';
    if (stream.match(/^[;,{}():]/)) { if (stream.current() === ';' || stream.current() === '{' || stream.current() === '}') state.lineStart = true; return null; }
    stream.next();
    return null;
  },
};
