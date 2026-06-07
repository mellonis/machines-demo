import type { SyntaxNode } from '@lezer/common';

export type InferredType =
  | { kind: 'class'; name: string }
  | { kind: 'constants'; name: string }
  | { kind: 'shape'; name: string }
  | { kind: 'function'; signatureRef: string };

export type InferredLocals = Map<string, InferredType>;

export type ImportsBinding =
  | { kind: 'present'; node: SyntaxNode; boundNames: Set<string>; isMultiLine: boolean; renames: Map<string, string> }
  | { kind: 'absent' };

export type ScannerResult = {
  locals: InferredLocals;
  importsBinding: ImportsBinding;
  /** All other top-level locals (untyped). Used by namespaceIdentifier rename detection. */
  rawLocals: Set<string>;
};
