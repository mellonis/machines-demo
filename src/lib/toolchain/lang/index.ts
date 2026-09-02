import { LanguageSupport, StreamLanguage, StringStream, type StreamParser } from '@codemirror/language';
import type { Lang } from '../types.ts';
import { pmaParser } from './pma.ts';
import { pmcParser } from './pmc.ts';
import { tmaParser } from './tma.ts';
import { tmcParser } from './tmc.ts';

export { pmaParser, pmcParser, tmaParser, tmcParser };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PARSERS: Record<Lang, StreamParser<any>> = { pmc: pmcParser, tmc: tmcParser, pma: pmaParser, tma: tmaParser };
const cache = new Map<Lang, LanguageSupport>();

export function toolchainLanguage(lang: Lang): LanguageSupport {
  let s = cache.get(lang);
  if (!s) { s = new LanguageSupport(StreamLanguage.define(PARSERS[lang])); cache.set(lang, s); }
  return s;
}

/** Test helper: tokenizes one line, returning `[text, style]` pairs. Pass the
 *  same `state` across calls to carry block-comment state between lines. */
export function tokenizeLine<S>(parser: StreamParser<S>, line: string, state: S = parser.startState!(2)): Array<[string, string | null]> {
  const stream = new StringStream(line, 2, 2);
  const out: Array<[string, string | null]> = [];
  while (!stream.eol()) {
    stream.start = stream.pos;
    const style = parser.token(stream, state);
    if (stream.pos === stream.start) stream.next();
    out.push([stream.current(), style]);
  }
  return out;
}
