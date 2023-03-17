import { path } from "../deps.ts";

const routesDir = path.join(Deno.cwd(), "routes");

export async function getNearest(
  absPath,
  targetTemplate,
  isRecursing = false,
) {
  // When initially invoked and no file extension, try using the absPath as parentDir.
  const parentDir = !isRecursing && !path.extname(absPath)
    ? absPath
    : path.dirname(absPath);
  const nearestPath = path.join(parentDir, targetTemplate);

  try {
    const nearestTemplate = await Deno.readTextFile(nearestPath);
    return { template: nearestTemplate, path: nearestPath };
  } catch (_) {
    null;
  }

  const reachedTop = path.normalize(parentDir) == path.normalize(routesDir) ||
    path.normalize(parentDir) == "/";
  return reachedTop ? null : await getNearest(parentDir, targetTemplate, true);
}
