import type { BufferKind, ExampleSeed } from './toolchain/types.ts';
import { toolchainExamples } from './toolchain/examples.ts';
import { isToolchainEngine, type Engine } from './types.ts';
import { POST_EXAMPLES, TURING_EXAMPLES } from './jsExamples.ts';

export type Example = {
  id: string;
  title: string;
  code: string;
  // Phase 1: showcase flag drives the Vite snippet recorder; description appears
  // as the panel caption; intervalMs overrides the playback default (800ms).
  showcase?: boolean;
  description?: string;
  // Rich learning-oriented prose shown beside the player in showcase panels.
  // Supports a tight markdown subset: paragraphs (blank-line separated),
  // bullet lists (lines starting with `- `), inline code (backticks).
  lessonNotes?: string;
  intervalMs?: number;
  /** Toolchain engines: the buffer language kind this example is written in (default `source`). */
  kind?: BufferKind;
  /** Toolchain engines: input tape per band, in glyphs. */
  seeds?: ExampleSeed[];
};

export function examples(engine: Engine): readonly Example[] {
  if (isToolchainEngine(engine)) return toolchainExamples(engine);
  return engine === 'post' ? POST_EXAMPLES : TURING_EXAMPLES;
}

export function findExample(engine: Engine, id: string): Example | undefined {
  return examples(engine).find((e) => e.id === id);
}

export function defaultExample(engine: Engine): Example {
  return examples(engine)[0];
}

export function defaultCode(engine: Engine): string {
  return defaultExample(engine).code;
}
