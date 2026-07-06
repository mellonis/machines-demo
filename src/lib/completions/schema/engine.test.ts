import { describe, it, expect } from 'vitest';
import * as turingNs from '@turing-machine-js/machine';
import * as postNs from '@post-machine-js/machine';
import { TURING_SCHEMA } from './turing.ts';
import { POST_SCHEMA } from './post.ts';
import type { EngineSchema, TypeRef } from './types.ts';

const COLLECT_TYPEREFS = (s: EngineSchema): TypeRef[] => {
  const refs: TypeRef[] = [];
  const push = (t: TypeRef) => {
    refs.push(t);
    if (t.kind === 'array') push(t.of);
    if (t.kind === 'union') t.of.forEach(push);
  };
  for (const entry of Object.values(s.namespace)) {
    if (entry.kind === 'function') {
      entry.params.forEach((p) => push(p.type));
      push(entry.returns);
    }
    if (entry.kind === 'singleton') push(entry.type);
    if (entry.kind === 'post-instruction' && entry.params) {
      entry.params.forEach((p) => push(p.type));
    }
  }
  for (const cls of Object.values(s.classes)) {
    cls.ctor?.params.forEach((p) => push(p.type));
    cls.members.forEach((m) => {
      push(m.type);
      m.params?.forEach((p) => push(p.type));
    });
  }
  for (const shape of Object.values(s.shapes)) {
    shape.keys.forEach((k) => {
      push(k.type);
      k.params?.forEach((p) => push(p.type));
    });
  }
  return refs;
};

// Expected runtime `typeof` per schema kind. Kinds that model callables
// must be functions at runtime and value tokens must be symbols — a
// name-existence check alone is blind to a callable↔value retype (post's
// `stop` becoming a unique-symbol token is exactly that drift shape).
const RUNTIME_TYPEOF_BY_KIND: Record<string, readonly string[]> = {
  class: ['function'],
  function: ['function'],
  symbol: ['symbol'],
  singleton: ['object', 'string'],
  constants: ['object'],
  // A post-instruction with `params` is a producer function; the bare-only
  // (paramless) shape used to model value-like commands as well, but those
  // now live under `symbol` — every remaining post-instruction is callable.
  'post-instruction': ['function'],
};

describe('schema drift guard', () => {
  for (const [label, schema, ns] of [
    ['turing', TURING_SCHEMA, turingNs],
    ['post', POST_SCHEMA, postNs],
  ] as const) {
    it(`S-schema-runtime-drift-${label} — every schema namespace entry is a runtime key of the kind-matching typeof`, () => {
      const runtime = ns as Record<string, unknown>;
      for (const [name, entry] of Object.entries(schema.namespace)) {
        expect(name in runtime, `Schema entry "${name}" not in the ${label} runtime`).toBe(true);
        const allowed = RUNTIME_TYPEOF_BY_KIND[entry.kind];
        expect(
          allowed,
          `kind "${entry.kind}" (entry "${name}") missing from RUNTIME_TYPEOF_BY_KIND — extend the map`,
        ).toBeDefined();
        expect(
          allowed.includes(typeof runtime[name]),
          `Schema entry "${name}" (kind: ${entry.kind}) is typeof ${typeof runtime[name]} at runtime — expected ${allowed.join(' | ')}`,
        ).toBe(true);
      }
    });
  }

  it('S-schema-stop-is-symbol — post stop is a non-callable value token in schema and runtime', () => {
    expect(POST_SCHEMA.namespace.stop.kind).toBe('symbol');
    expect(typeof (postNs as Record<string, unknown>).stop).toBe('symbol');
  });

  it('S-schema-abort-is-symbol — post abort is a non-callable value token in schema and runtime', () => {
    expect(POST_SCHEMA.namespace.abort.kind).toBe('symbol');
    expect(typeof (postNs as Record<string, unknown>).abort).toBe('symbol');
  });
});

describe('schema closure', () => {
  for (const [label, schema] of [['turing', TURING_SCHEMA], ['post', POST_SCHEMA]] as const) {
    it(`S-schema-typeref-closure-${label} — every TypeRef of kind class/shape/constants resolves`, () => {
      for (const ref of COLLECT_TYPEREFS(schema)) {
        if (ref.kind === 'class' && !schema.classes[ref.name]) {
          throw new Error(`TypeRef class "${ref.name}" missing in ${label} classes`);
        }
        if (ref.kind === 'shape' && !schema.shapes[ref.name]) {
          throw new Error(`TypeRef shape "${ref.name}" missing in ${label} shapes`);
        }
        if (ref.kind === 'constants' && !schema.constants[ref.name]) {
          throw new Error(`TypeRef constants "${ref.name}" missing in ${label} constants`);
        }
      }
    });
  }
});

describe('schema ctor options shape exists', () => {
  for (const [label, schema] of [['turing', TURING_SCHEMA], ['post', POST_SCHEMA]] as const) {
    it(`S-schema-ctor-options-shape-exists-${label}`, () => {
      for (const [clsName, cls] of Object.entries(schema.classes)) {
        if (cls.ctor?.optionsShape) {
          expect(schema.shapes[cls.ctor.optionsShape], `${label} class ${clsName} optionsShape '${cls.ctor.optionsShape}' missing`).toBeDefined();
        }
      }
    });
  }
});

describe('schema constants non-empty', () => {
  it('S-schema-constants-nonempty-turing', () => {
    for (const [name, c] of Object.entries(TURING_SCHEMA.constants)) {
      expect(c.keys.length, `turing constants ${name} empty`).toBeGreaterThan(0);
    }
  });
});
