import { tags, type Tag } from '@lezer/highlight';

/** One palette for the four stream modes. Keys are the style names the
 *  tokenizers return; values are the highlight tags One Dark / the default
 *  light style already color. */
export const tokenTable: Record<string, Tag> = {
  kw: tags.keyword,
  cmt: tags.comment,
  doc: tags.docComment,
  num: tags.number,
  glyph: tags.string,
  op: tags.operator,
  move: tags.operator,
  label: tags.labelName,
  fn: tags.function(tags.variableName),
  ns: tags.namespace,
  type: tags.typeName,
  directive: tags.processingInstruction,
  wild: tags.atom,
  sym: tags.variableName,
};

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
export const QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+/;
