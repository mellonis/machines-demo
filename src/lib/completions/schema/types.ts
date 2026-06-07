export type TypeRef =
  | { kind: 'primitive'; name: 'string' | 'number' | 'boolean' | 'unknown' }
  | { kind: 'class'; name: string }
  | { kind: 'shape'; name: string }
  | { kind: 'constants'; name: string }
  | { kind: 'array'; of: TypeRef }
  | { kind: 'union'; of: TypeRef[] }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'symbol' };

export type ParamSpec = {
  name: string;
  type: TypeRef;
  optional?: true;
  detail?: string;
};

export type MemberSpec = {
  name: string;
  kind: 'property' | 'method' | 'getter';
  type: TypeRef;
  params?: ParamSpec[];
  detail: string;
};

export type ShapeSpec = { keys: MemberSpec[] };

export type ClassSpec = {
  ctor?: { params: ParamSpec[]; optionsShape?: string };
  members: MemberSpec[];
  detail: string;
};

export type NamespaceEntry =
  | { kind: 'class'; classRef: string; detail: string }
  | { kind: 'function'; params: ParamSpec[]; returns: TypeRef; detail: string }
  | { kind: 'singleton'; type: TypeRef; detail: string }
  | { kind: 'constants'; constantsRef: string; detail: string }
  | { kind: 'symbol'; detail: string }
  | { kind: 'post-instruction'; params?: ParamSpec[]; detail: string };

export type EngineSchema = {
  namespace: Record<string, NamespaceEntry>;
  classes: Record<string, ClassSpec>;
  shapes: Record<string, ShapeSpec>;
  constants: Record<string, { keys: string[]; detail: string }>;
};
