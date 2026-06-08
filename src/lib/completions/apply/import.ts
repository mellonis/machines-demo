import type { EditorView } from '@codemirror/view';
import type { Completion } from '@codemirror/autocomplete';
import type { ChangeSpec } from '@codemirror/state';
import type { EngineSchema } from '../schema/types.ts';
import { inferLocalsFor } from '../scan/locals.ts';
import type { ScannerResult } from '../scan/types.ts';

type PresentBinding = Extract<ScannerResult['importsBinding'], { kind: 'present' }>;

export function applyAutoImport(
  view: EditorView,
  _completion: Completion,
  from: number,
  to: number,
  insertedName: string,
  schema: EngineSchema,
): void {
  const { importsBinding } = inferLocalsFor(view.state, schema);
  const changes: ChangeSpec[] = [{ from, to, insert: insertedName }];

  if (importsBinding.kind === 'present') {
    const alreadyBound = importsBinding.boundNames.has(insertedName)
      || Array.from(importsBinding.renames.values()).includes(insertedName);
    if (!alreadyBound) {
      const change = buildPresentBlockInsert(view, importsBinding, insertedName);
      if (change) changes.unshift(change);
    }
  } else {
    const change = buildAbsentBlockInsert(view, insertedName);
    if (change) changes.unshift(change);
  }

  view.dispatch({ changes, userEvent: 'input.complete' });
}

function buildPresentBlockInsert(
  view: EditorView,
  binding: PresentBinding,
  name: string,
): ChangeSpec | null {
  const { node, boundNames, isMultiLine } = binding;
  const propsInOrder: { from: number; to: number; name: string }[] = [];
  let prop = node.firstChild;
  while (prop) {
    if (prop.name === 'PatternProperty' || prop.name === 'Property') {
      const k = prop.firstChild;
      if (k) {
        propsInOrder.push({ from: prop.from, to: prop.to, name: view.state.doc.sliceString(k.from, k.to) });
      }
    }
    prop = prop.nextSibling;
  }

  if (propsInOrder.length === 0) {
    return { from: node.from + 1, to: node.from + 1, insert: ` ${name} ` };
  }

  const sortedNames = [...boundNames].sort();
  const targetIdx = sortedNames.findIndex((n) => name < n);
  const insertBefore = targetIdx === -1 ? null : propsInOrder.find((p) => p.name === sortedNames[targetIdx]);

  if (isMultiLine) {
    const lineStart = view.state.doc.lineAt(propsInOrder[0].from).from;
    const indentMatch = /^\s*/.exec(view.state.doc.sliceString(lineStart, propsInOrder[0].from));
    const indent = indentMatch?.[0] ?? '  ';
    if (insertBefore) {
      return { from: insertBefore.from, to: insertBefore.from, insert: `${name},\n${indent}` };
    }
    const last = propsInOrder[propsInOrder.length - 1];
    return { from: last.to, to: last.to, insert: `,\n${indent}${name}` };
  }

  if (insertBefore) {
    return { from: insertBefore.from, to: insertBefore.from, insert: `${name}, ` };
  }
  const last = propsInOrder[propsInOrder.length - 1];
  return { from: last.to, to: last.to, insert: `, ${name}` };
}

function buildAbsentBlockInsert(view: EditorView, name: string): ChangeSpec | null {
  const text = view.state.doc.toString();
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    break;
  }
  const insertAt = i;
  return { from: insertAt, to: insertAt, insert: `const { ${name} } = imports;\n` };
}
