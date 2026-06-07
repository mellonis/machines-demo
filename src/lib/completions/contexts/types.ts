import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Engine } from '../../types.ts';
import type { EngineSchema } from '../schema/types.ts';

export type Env = { engine: Engine; schema: EngineSchema };
export type CompletionSourceFactory = (env: Env) => (ctx: CompletionContext) => CompletionResult | null;
