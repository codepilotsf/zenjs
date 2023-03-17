import { getStyleTag, setup, shim, twColors, virtualSheet } from "../deps.ts";

// Todo: wrap in try/catch
const pathToTwindConfig = Deno.execPath() + "/twind.config.ts";
const config = await import(pathToTwindConfig);
const twindConfig = config.default;

// Extend the tailwind config with additional taiwind colors.
if (twindConfig?.theme?.extend?.colors) {
  twindConfig.theme.extend.colors = {
    ...twindConfig.theme.extend.colors,
    ...twColors,
  };
}

const sheet = virtualSheet();
setup({ ...twindConfig, sheet });

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
