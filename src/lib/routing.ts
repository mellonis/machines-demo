import { ENGINES, JS_ENGINES, type Engine, type JsEngine, type Route } from './types';

export function readRouteFromUrl(pathname: string): Route {
  const seg = pathname.replace(/^\/+/, '').split('/')[0];
  if ((ENGINES as readonly string[]).includes(seg)) {
    return { kind: 'engine', engine: seg as Engine };
  }
  return { kind: 'landing' };
}

export function readEngineFromLandingQuery(search: string): JsEngine {
  const params = new URLSearchParams(search);
  const raw = params.get('engine');
  return (JS_ENGINES as readonly string[]).includes(raw ?? '') ? (raw as JsEngine) : 'turing';
}

export function legacyMachineRewrite(url: URL): URL {
  const legacy = url.searchParams.get('machine');
  if (legacy !== null) {
    url.searchParams.delete('machine');
    if ((ENGINES as readonly string[]).includes(legacy)) {
      url.pathname = '/' + legacy;
    }
  }
  return url;
}
