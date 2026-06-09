import { syntaxTree } from '@codemirror/language';
import { StateField } from '@codemirror/state';
import type { EditorState, Extension } from '@codemirror/state';
import { showTooltip, type Tooltip } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { Env } from '../contexts/types.ts';
import type { ResolvedCallee, SignatureInfo } from './types.ts';
import { formatTypeRef } from './format.ts';
import { inferLocalsFor } from '../scan/locals.ts';
import type { InferredType } from '../scan/types.ts';
import type { MemberSpec } from '../schema/types.ts';

function findEnclosingArgList(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (node) {
    if (node.name === 'ArgList') return node;
    node = node.parent;
  }
  return null;
}

function text(node: SyntaxNode, state: EditorState): string {
  return state.doc.sliceString(node.from, node.to);
}

function activeArgIndex(argList: SyntaxNode, pos: number): number {
  let commas = 0;
  let child = argList.firstChild;
  while (child) {
    if (child.name === ',' && child.to <= pos) commas += 1;
    child = child.nextSibling;
  }
  return commas;
}

// Reverse-lookup: given a local alias, find the original export name in importsBinding.renames.
// Returns null when the alias was not imported via a rename (direct destructure or not imported).
function originalImportName(alias: string, env: Env, state: EditorState): string | null {
  const { importsBinding } = inferLocalsFor(state, env.schema);
  if (importsBinding.kind !== 'present') return null;
  for (const [original, local] of importsBinding.renames) {
    if (local === alias) return original;
  }
  return null;
}

// Maps the signatureRef string back to its (class, member) pair via the schema.
// Currently only `TapeBlock.symbol` is emitted; the resolver is written to handle
// any "<receiver>.<member>" where <receiver> matches a namespace entry.
function resolveSignatureRef(signatureRef: string, env: Env): MemberSpec | null {
  const dot = signatureRef.indexOf('.');
  if (dot < 0) return null;
  const receiverName = signatureRef.slice(0, dot);
  const methodName = signatureRef.slice(dot + 1);
  const ns = env.schema.namespace[receiverName];
  if (!ns) return null;
  let className: string | null = null;
  if (ns.kind === 'class') className = ns.classRef;
  else if (ns.kind === 'singleton' && ns.type.kind === 'class') className = ns.type.name;
  if (!className) return null;
  const cls = env.schema.classes[className];
  if (!cls) return null;
  return cls.members.find((m) => m.name === methodName) ?? null;
}

function lookupMethod(localType: InferredType, methodName: string, env: Env): MemberSpec | null {
  if (localType.kind === 'class') {
    const cls = env.schema.classes[localType.name];
    if (!cls) return null;
    return cls.members.find((m) => m.name === methodName && m.kind === 'method') ?? null;
  }
  if (localType.kind === 'function') {
    // The local is itself a destructured method (e.g. `const { symbol } = tb`).
    // The methodName here would be something invoked ON that function — out of scope.
    return null;
  }
  return null;
}

export function resolveCallee(argList: SyntaxNode, state: EditorState, env: Env): ResolvedCallee | null {
  const call = argList.parent;
  if (!call) return null;
  if (call.name !== 'CallExpression' && call.name !== 'NewExpression') return null;

  const callee = call.firstChild;
  if (!callee || callee === argList) return null;

  // CallExpression with bare VariableName: namespace function or a typed local function.
  if (call.name === 'CallExpression' && callee.name === 'VariableName') {
    const typed = text(callee, state);
    const schemaName = env.schema.namespace[typed] ? typed : (originalImportName(typed, env, state) ?? typed);
    const entry = env.schema.namespace[schemaName];
    if (entry?.kind === 'function') return { params: entry.params, header: typed };
    if (entry?.kind === 'post-instruction' && entry.params) return { params: entry.params, header: typed };

    // Locally-typed function fallback (destructured method) — unchanged.
    const { locals } = inferLocalsFor(state, env.schema);
    const local = locals.get(typed);
    if (local?.kind === 'function') {
      const member = resolveSignatureRef(local.signatureRef, env);
      if (member?.params) return { params: member.params, header: typed };
    }
    return null;
  }

  // CallExpression with MemberExpression callee: receiver.method(...)
  if (call.name === 'CallExpression' && callee.name === 'MemberExpression') {
    const receiver = callee.firstChild;
    const dot = receiver?.nextSibling;
    const method = callee.lastChild;
    if (!receiver || receiver.name !== 'VariableName' || !method || method.name !== 'PropertyName') return null;
    if (!dot || dot.name !== '.') return null;

    const receiverName = text(receiver, state);
    const methodName = text(method, state);
    const { locals } = inferLocalsFor(state, env.schema);

    let localType: InferredType | null = locals.get(receiverName) ?? null;
    if (!localType) {
      // Fall back to namespace (e.g. `haltState.<...>` if the user typed it bare).
      const ns = env.schema.namespace[receiverName];
      if (ns?.kind === 'class') localType = { kind: 'class', name: ns.classRef };
      else if (ns?.kind === 'singleton' && ns.type.kind === 'class') localType = { kind: 'class', name: ns.type.name };
    }
    if (!localType) return null;

    const member = lookupMethod(localType, methodName, env);
    if (!member?.params) return null;

    return { params: member.params, header: `${receiverName}.${methodName}` };
  }

  if (call.name === 'NewExpression') {
    // NewExpression children: `new` keyword, VariableName (the class), ArgList.
    // `callee` is the `new` keyword node; the class name is the next sibling.
    const classNode = callee.name === 'VariableName' ? callee : callee.nextSibling;
    if (!classNode || classNode.name !== 'VariableName') return null;
    const typed = text(classNode, state);
    const schemaName = env.schema.classes[typed] ? typed : (originalImportName(typed, env, state) ?? typed);
    const cls = env.schema.classes[schemaName];
    if (!cls?.ctor) return null;
    return { params: cls.ctor.params, header: `new ${typed}` };
  }

  return null;
}

export function computeSignatureInfo(state: EditorState, env: Env): SignatureInfo | null {
  const pos = state.selection.main.head;
  const argList = findEnclosingArgList(state, pos);
  if (!argList) return null;

  const resolved = resolveCallee(argList, state, env);
  if (!resolved) return null;
  if (resolved.params.length === 0) return null;

  const activeIndex = activeArgIndex(argList, pos);
  if (activeIndex >= resolved.params.length) return null;

  const params = resolved.params.map((p) => ({
    name: p.name,
    typeStr: formatTypeRef(p.type),
    optional: p.optional === true,
  }));

  return {
    header: resolved.header,
    params,
    activeIndex,
    anchor: argList.from,
  };
}

function renderTooltipDom(info: SignatureInfo): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-tooltip-sig-help sig-help';
  const head = document.createElement('span');
  head.className = 'sig-callee';
  head.textContent = `${info.header}(`;
  dom.appendChild(head);

  info.params.forEach((p, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.textContent = ', ';
      dom.appendChild(sep);
    }
    const span = document.createElement('span');
    span.className = i === info.activeIndex ? 'sig-param sig-active' : 'sig-param';
    span.textContent = `${p.name}${p.optional ? '?' : ''}: ${p.typeStr}`;
    dom.appendChild(span);
  });

  const tail = document.createElement('span');
  tail.className = 'sig-callee';
  tail.textContent = ')';
  dom.appendChild(tail);
  return dom;
}

function infoToTooltip(info: SignatureInfo, field: StateField<SignatureInfo | null>): Tooltip {
  return {
    pos: info.anchor,
    above: true,
    arrow: false,
    create: () => {
      const dom = renderTooltipDom(info);
      return {
        dom,
        update: (viewUpdate) => {
          const fresh = viewUpdate.state.field(field);
          if (!fresh) return;
          const replacement = renderTooltipDom(fresh);
          dom.replaceChildren(...replacement.childNodes);
          dom.className = replacement.className;
        },
      };
    },
  };
}

export function signatureHelp(env: Env): Extension {
  const field = StateField.define<SignatureInfo | null>({
    create: (state) => computeSignatureInfo(state, env),
    update: (value, tr) => {
      if (!tr.docChanged && !tr.selection) return value;
      return computeSignatureInfo(tr.state, env);
    },
  });
  return [
    field,
    showTooltip.compute([field], (state) => {
      const info = state.field(field);
      return info ? infoToTooltip(info, field) : null;
    }),
  ];
}
