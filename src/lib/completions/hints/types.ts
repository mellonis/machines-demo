import type { ParamSpec } from '../schema/types.ts';

export type ParamRender = {
  name: string;
  typeStr: string;
  optional: boolean;
};

export type SignatureInfo = {
  header: string;
  params: ParamRender[];
  activeIndex: number;
  anchor: number;
};

export type ResolvedCallee = {
  params: ParamSpec[];
  header: string;
};
