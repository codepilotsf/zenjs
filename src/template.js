import { parseLocals, parseModifiers, parseTwind } from '../mod.js';

export function parseTemplate(template, ctx) {
  let dom;
  dom = parseLocals(template, ctx);
  dom = parseModifiers(dom, ctx);
  dom = parseTwind(dom);
  return dom;
}
