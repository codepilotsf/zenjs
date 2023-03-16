import { getStyleTag, setup, shim, virtualSheet } from "./deps.ts";

const twConfig = await getTwindConfig();
const sheet = virtualSheet();
setup({ ...twConfig, sheet });

async function getTwindConfig() {
  try {
    const twConfigModule = await import("../twind.config.ts");
    return twConfigModule.default;
  } catch (error) {
    console.log("Failed to parse twind.json:", error);
  }
}

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
