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

describe('schema drift guard', () => {
  it('S-schema-runtime-drift-turing — every TURING_SCHEMA.namespace entry is a runtime key', () => {
    const runtimeKeys = new Set(Object.keys(turingNs));
    for (const name of Object.keys(TURING_SCHEMA.namespace)) {
      expect(runtimeKeys.has(name), `Schema entry "${name}" not in @turing-machine-js/machine runtime`).toBe(true);
    }
  });

  it('S-schema-runtime-drift-post — every POST_SCHEMA.namespace entry is a runtime key', () => {
    const runtimeKeys = new Set(Object.keys(postNs));
    for (const name of Object.keys(POST_SCHEMA.namespace)) {
      expect(runtimeKeys.has(name), `Schema entry "${name}" not in @post-machine-js/machine runtime`).toBe(true);
    }
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
