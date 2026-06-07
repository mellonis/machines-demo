import type { Engine } from '../../types.ts';
import type { EngineSchema } from './types.ts';
import { TURING_SCHEMA } from './turing.ts';
import { POST_SCHEMA } from './post.ts';

export function getSchema(engine: Engine): EngineSchema {
  return engine === 'post' ? POST_SCHEMA : TURING_SCHEMA;
}

export type { EngineSchema, NamespaceEntry, ClassSpec, ShapeSpec, MemberSpec, ParamSpec, TypeRef } from './types.ts';
