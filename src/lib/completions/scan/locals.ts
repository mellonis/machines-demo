import type { SyntaxNode } from '@lezer/common';
import { StateField, type EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { EngineSchema } from '../schema/types.ts';
import type { InferredLocals, InferredType, ImportsBinding, ScannerResult } from './types.ts';
import { TURING_SCHEMA } from '../schema/turing.ts';

const NULL_RESULT: ScannerResult = {
  locals: new Map(),
  importsBinding: { kind: 'absent' },
  rawLocals: new Set(),
};

function* topLevelStatements(root: SyntaxNode): Iterable<SyntaxNode> {
  let c = root.firstChild;
  while (c) {
    yield c;
    c = c.nextSibling;
  }
}

const nodeText = (node: SyntaxNode, src: string): string => src.slice(node.from, node.to);

function namespaceEntryToType(name: string, schema: EngineSchema): InferredType | null {
  const entry = schema.namespace[name];
  if (!entry) return null;
  if (entry.kind === 'class') return { kind: 'class', name: entry.classRef };
  if (entry.kind === 'constants') return { kind: 'constants', name: entry.constantsRef };
  if (entry.kind === 'singleton' && entry.type.kind === 'class') return { kind: 'class', name: entry.type.name };
  return null;
}

function rhsOf(lhs: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = lhs.nextSibling;
  if (cur && cur.name === 'Equals') cur = cur.nextSibling;
  return cur ?? null;
}

function newExprKnownClass(rhs: SyntaxNode, src: string, schema: EngineSchema): string | null {
  if (rhs.name !== 'NewExpression') return null;
  let child = rhs.firstChild;
  while (child && child.name !== 'VariableName') child = child.nextSibling;
  if (!child) return null;
  const name = nodeText(child, src);
  return schema.classes[name] ? name : null;
}

function callExprReturn(rhs: SyntaxNode, src: string): InferredType | null {
  if (rhs.name !== 'CallExpression') return null;
  const callee = rhs.firstChild;
  if (!callee || callee.name !== 'MemberExpression') return null;
  const method = callee.lastChild;
  if (!method || method.name !== 'PropertyName') return null;
  const methodName = nodeText(method, src);
  if (methodName === 'withOverriddenHaltState' || methodName === 'tag') {
    return { kind: 'class', name: 'State' };
  }
  if (methodName === 'fromTapes') {
    return { kind: 'class', name: 'TapeBlock' };
  }
  return null;
}

function memberOnImports(rhs: SyntaxNode, src: string, schema: EngineSchema): InferredType | null {
  if (rhs.name !== 'MemberExpression') return null;
  const left = rhs.firstChild;
  const right = rhs.lastChild;
  if (!left || !right || left.name !== 'VariableName' || nodeText(left, src) !== 'imports' || right.name !== 'PropertyName') return null;
  return namespaceEntryToType(nodeText(right, src), schema);
}

function readObjectPattern(pattern: SyntaxNode, src: string): { boundNames: Set<string>; renames: Map<string, string>; isMultiLine: boolean } {
  const boundNames = new Set<string>();
  const renames = new Map<string, string>();
  const isMultiLine = src.slice(pattern.from, pattern.to).includes('\n');

  let prop = pattern.firstChild;
  while (prop) {
    if (prop.name === 'PatternProperty' || prop.name === 'Property') {
      const propName = prop.firstChild;
      if (propName && (propName.name === 'PropertyName' || propName.name === 'VariableDefinition' || propName.name === 'VariableName')) {
        const imported = nodeText(propName, src);
        boundNames.add(imported);
        let sib = propName.nextSibling;
        while (sib) {
          if (sib.name === 'VariableDefinition') {
            renames.set(imported, nodeText(sib, src));
            break;
          }
          sib = sib.nextSibling;
        }
      }
    }
    prop = prop.nextSibling;
  }
  return { boundNames, renames, isMultiLine };
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export function scanLocals(src: string, root: SyntaxNode, schema: EngineSchema): ScannerResult {
  return safe(() => doScan(src, root, schema), NULL_RESULT);
}

function doScan(src: string, root: SyntaxNode, schema: EngineSchema): ScannerResult {
  const locals: InferredLocals = new Map();
  const rawLocals = new Set<string>();
  let importsBinding: ImportsBinding = { kind: 'absent' };
  const allBoundNames = new Set<string>();
  let firstImportsPatternNode: SyntaxNode | null = null;
  let firstImportsPatternIsMultiLine = false;
  const firstImportsRenames = new Map<string, string>();

  for (const stmt of topLevelStatements(root)) {
    if (stmt.name !== 'VariableDeclaration') continue;

    let child: SyntaxNode | null = stmt.firstChild;
    while (child && (child.name === 'const' || child.name === 'let' || child.name === 'var')) {
      child = child.nextSibling;
    }

    while (child) {
      const lhs = child;

      if (lhs.name === 'VariableDefinition') {
        const localName = nodeText(lhs, src);
        rawLocals.add(localName);
        const rhs = rhsOf(lhs);
        if (rhs) {
          const ne = newExprKnownClass(rhs, src, schema);
          const inferred: InferredType | null =
            (ne ? { kind: 'class', name: ne } : null)
            ?? callExprReturn(rhs, src)
            ?? memberOnImports(rhs, src, schema);
          if (inferred) {
            locals.set(localName, inferred);
            child = skipToNextDeclarator(lhs);
            continue;
          }
          if (rhs.name === 'VariableName') {
            const refName = nodeText(rhs, src);
            const inferredFromNamespace = namespaceEntryToType(refName, schema);
            if (!inferredFromNamespace) {
              const fromLocals = locals.get(refName);
              if (fromLocals) locals.set(localName, fromLocals);
            } else {
              locals.set(localName, inferredFromNamespace);
            }
          }
        }
        child = skipToNextDeclarator(lhs);
        continue;
      }

      if (lhs.name === 'ObjectPattern') {
        const rhs = rhsOf(lhs);
        const initIsImports = rhs?.name === 'VariableName' && nodeText(rhs, src) === 'imports';
        const { boundNames, renames, isMultiLine } = readObjectPattern(lhs, src);

        if (initIsImports) {
          if (firstImportsPatternNode === null) {
            firstImportsPatternNode = lhs;
            firstImportsPatternIsMultiLine = isMultiLine;
          }
          for (const [imported, local] of renames) {
            firstImportsRenames.set(imported, local);
          }
          for (const name of boundNames) {
            allBoundNames.add(name);
            const local = renames.get(name) ?? name;
            rawLocals.add(local);
            const inferred = namespaceEntryToType(name, schema);
            if (inferred) locals.set(local, inferred);
          }
        } else if (rhs?.name === 'VariableName') {
          const rhsName = nodeText(rhs, src);
          const rhsType = locals.get(rhsName);
          for (const name of boundNames) {
            const local = renames.get(name) ?? name;
            rawLocals.add(local);
            if (rhsType?.kind === 'class' && rhsType.name === 'TapeBlock' && name === 'symbol') {
              locals.set(local, { kind: 'function', signatureRef: 'TapeBlock.symbol' });
            }
          }
        } else {
          for (const name of boundNames) {
            const local = renames.get(name) ?? name;
            rawLocals.add(local);
          }
        }
        child = skipToNextDeclarator(lhs);
        continue;
      }

      child = child.nextSibling;
    }
  }

  if (firstImportsPatternNode) {
    importsBinding = {
      kind: 'present',
      node: firstImportsPatternNode,
      boundNames: allBoundNames,
      isMultiLine: firstImportsPatternIsMultiLine,
      renames: firstImportsRenames,
    };
  }

  return { locals, importsBinding, rawLocals };
}

function skipToNextDeclarator(lhs: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = lhs.nextSibling;
  while (cur) {
    if (cur.name === 'VariableDefinition' || cur.name === 'ObjectPattern') return cur;
    cur = cur.nextSibling;
  }
  return null;
}

const _cache = new WeakMap<object, { result: ScannerResult; schema: EngineSchema }>();

export function inferLocalsFor(state: EditorState, schema: EngineSchema): ScannerResult {
  const tree = syntaxTree(state);
  const cached = _cache.get(tree as unknown as object);
  if (cached && cached.schema === schema) return cached.result;
  const result = scanLocals(state.doc.toString(), tree.topNode, schema);
  _cache.set(tree as unknown as object, { result, schema });
  return result;
}

export const localsField = StateField.define<ScannerResult>({
  create: (state) => inferLocalsFor(state, TURING_SCHEMA),
  update: (value, tr) => tr.docChanged ? inferLocalsFor(tr.state, TURING_SCHEMA) : value,
});
