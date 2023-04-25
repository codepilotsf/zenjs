import { parseLocals, parseModifiers, parseTwind } from "../mod.js";

export async function parseTemplate(template, ctx) {
  let dom;
  dom = await parseLocals(template, ctx);
  dom = parseModifiers(dom, ctx);
  dom = parseTwind(dom);
  return dom;
}

// export async function parseTemplate(template, ctx) {
//   if (template instanceof Promise) {
//     template = await template;
//   }
//   let dom;
//   dom = parseLocals(template, ctx);
//   dom = parseModifiers(dom, ctx);
//   dom = parseTwind(dom);
//   return dom;
// }
