import { getStyleTag, setup, shim, virtualSheet } from "./deps.ts";
import { getConfig } from "./mod.ts";

const { tailwindConfig } = await getConfig();
const sheet = virtualSheet();
setup({ ...tailwindConfig, sheet });

export function parseTwind(dom) {
  sheet.reset();
  // Convert to a string for twind operations.
  let template = dom.toString();
  template = shim(template);
  const styleTag = getStyleTag(sheet);
  const twindTag = dom.getElementById("__twind");
  if (twindTag) twindTag.innerHTML = styleTag;
  return dom;
}
