// deno-lint-ignore-file no-explicit-any

import { env, expandGlob, parseHTML, path } from "../deps.ts";
import { getActionCtx, getInitCtx, logger, reloadEmitter } from "../mod.ts";

// Cache pages, actions, and errors (not used for dev mode).
const pagesCache: Map<string, { [k: string]: string }> = new Map();
const actionsCache: Map<string, { [k: string]: any }> = new Map();
const errorsCache: Map<string, string> = new Map();
const validRelativeUrlRE = /^\/(?:[a-zA-Z\-\$_/\.:]+\/)*[a-zA-Z\-\$_/\.:]*$/;

const pagesDir = path.join(Deno.cwd(), "pages");
const actionsDir = path.join(Deno.cwd(), "actions");

let noCache = 0;

export function getRoutes(Router: any) {
  const router = new Router();
  return env.DEV ? getRoutesFromFiles(router) : getRoutesFromCache(router);
}

export async function getErrorTemplate(
  status: 404 | 500,
  url: string,
  urlParts?: string[],
): Promise<string> {
  urlParts = urlParts || url.split("/").filter((p) => p !== "");
  urlParts.pop();
  const maybeNearestErrorUrl = "/" + [...urlParts, `_${status}`].join("/");
  if (env.DEV) {
    // Serve nearest error template from file.
    const maybeNearestErrorAbsPath = path.join(pagesDir, maybeNearestErrorUrl) +
      ".njk";
    try {
      const maybeNearestErrorTemplate = await Deno.readTextFile(
        maybeNearestErrorAbsPath,
      );
      return maybeNearestErrorTemplate;
    } catch (_) { /* ignore */ }
  } else {
    // Serve nearest error template from cache.
    const maybeNearestErrorTemplate = errorsCache.get(maybeNearestErrorUrl);
    if (maybeNearestErrorTemplate) {
      return maybeNearestErrorTemplate;
    }
  }

  return urlParts.length > 0
    ? getErrorTemplate(status, url, urlParts)
    : getDefaultErrorTemplate(status);
}

////////////////////////////////////////////////////////////////

// Build live routes for pages and actions on demand for each request (for dev mode).
function getRoutesFromFiles(router) {
  // ## PAGES ##

  // Create route for on demand pages.
  router.get("(.*)", async (context, next) => {
    const pathname = context.request.url.pathname;

    // If any part of path starts with "_", skip it.
    const isHidden = pathname.split("/").filter((f) =>
      f.startsWith("_")
    ).length;
    if (isHidden) {
      await next();
      return;
    }

    // Try to find a matching page in pages dir.
    const [page, params] = await getPageFromFiles(pathname);

    // If params were returns, set them as context params.
    if (params) context.params = params;

    // If no matching file is found, go to next middleware.
    if (!page) {
      await next();
      return;
    }

    // Page was found. Render it.
    const ctx = getInitCtx(context, page);
    await ctx.page.initFunction(ctx, ctx.$);
    context.state.session.set("_state_", {
      $: ctx.$,
      $meta: ctx.$meta,
      page: ctx.page,
    });
  });

  // ## ACTIONS ##

  // Create route for on demands actions.
  router.post("/@/(.*)", async (context, next) => {
    noCache++;
    const relativePath = context.request.url.pathname.slice(3) + ".ts";

    // If any part of path starts with "_", skip it.
    const isHidden = relativePath.split("/").filter((f) =>
      f.startsWith("_")
    ).length;
    if (isHidden) {
      await next();
      return;
    }

    const submitted = context.request.body();
    const { trigger, lastFocused, payload } = await submitted.value;
    const action = { trigger, lastFocused, payload };
    const ctx = getActionCtx(context, action);

    const actionsAbsPath = path.join(actionsDir, relativePath);
    let actionsModule;
    try {
      const importPathToActionsModule =
        `file://${actionsAbsPath}?nocache=${noCache}`;
      actionsModule = await import(importPathToActionsModule);
    } catch (_) {
      logger.error("No actions module found at: /" + actionsAbsPath);
      ctx.ignore();
      return;
    }
    if (!actionsModule?.default[ctx.actionsMethod]) {
      logger.error(
        `No action "${ctx.actionsMethod}" found in: /${relativePath}`,
      );
      ctx.ignore();
      return;
    }
    await actionsModule.default[ctx.actionsMethod](ctx, ctx.$);
  });

  // Add a listener for devReload SSE?
  let isFreshServerStart = true;
  router.get("/__reload", (context) => {
    const target = context.sendEvents();
    if (isFreshServerStart) {
      target.dispatchMessage("hardReset");
      isFreshServerStart = false;
    }
    reloadEmitter.removeAllListeners("remergePage");
    reloadEmitter.removeAllListeners("relinkStaticResources");
    reloadEmitter.on("remergePage", () => {
      target.dispatchMessage("remergePage");
    });
    reloadEmitter.on("relinkStaticResources", () => {
      target.dispatchMessage("relinkStaticResources");
    });
  });
  return router.routes();
}

// Return routes for pages and actions cached at server start time (for non-dev mode).
async function getRoutesFromCache(router) {
  // For all other enviroments cache: pagesPaths, errorsPaths, and actionsPaths.
  const pagesAndErrorsPaths = await listPathsInDir(pagesDir, ".njk");
  const { pagesPaths, errorsPaths } = splitPagesAndErrors(pagesAndErrorsPaths);
  const actionsPaths = await listPathsInDir(actionsDir, ".ts");

  // For each actionPath, add an entry to actionsCache. (do this before pagePaths so init actions are available)
  for (const actionsPath of actionsPaths) {
    const actionsModule = actionsPath.replace(actionsDir, "").slice(1, -3); // ex: "about-us/history"
    const actionsModuleDefault = await import("file://" + actionsPath);
    const actionsModuleObject = actionsModuleDefault.default;
    actionsCache.set(actionsModule, actionsModuleObject);

    // Add action route ex: "/@/books?<actionName>"
    router.post("/@/" + actionsModule, async (context) => {
      const submitted = context.request.body();
      const { trigger, lastFocused, payload } = await submitted.value;
      const action = { trigger, lastFocused, payload };
      const ctx = getActionCtx(context, action);
      const actionsMethod = ctx.actionsMethod;
      const actionsModuleObject = actionsCache.get(actionsModule);
      if (!actionsModuleObject) {
        logger.error(
          "No actions module found for: /actions/" + actionsModule,
        );
        return;
      }

      const actionFunction = actionsModuleObject[actionsMethod];
      if (!actionFunction) {
        logger.error(
          `No action "${actionFunction}" found in: /actions/${actionsModule}`,
        );
        return;
      }
      await actionFunction(ctx, ctx.$);
      context.state.session.set("_state_", {
        $: ctx.$,
        $meta: ctx.$meta,
        page: ctx.page,
      });
    });
  }

  // For each pagePath, add an entry to pagesCache and a GET route to router.
  for (const pagePath of pagesPaths) {
    const endpoint = convertToEndpoint(pagePath); // ex: /produts/:id

    if (!validRelativeUrlRE.test(endpoint)) {
      logger.error(
        `Invalid characters in endpoint: ${endpoint}. Page paths must be valid URL segments.`,
      );
      continue;
    }
    const page = await getPageObjectFromPagePath(pagePath);
    const route = getRoute(page);
    pagesCache.set(endpoint, page);
    router.get(endpoint, route);
    // If this is an index page, add a route for the directory.
    if (pagePath.endsWith("/index.njk")) {
      const indexEndpoint = endpoint.slice(0, -6) || "/"; // ex: "/about-us" or "/"
      pagesCache.set(indexEndpoint, page);
      router.get(indexEndpoint, route);
    }
  }

  // For each errorPath, add an entry to errorsCache.
  for (const errorPath of errorsPaths) {
    const endpoint = "/" + path.relative(pagesDir, errorPath).slice(0, -4); // ex: "/about-us/_404"
    errorsCache.set(endpoint, Deno.readTextFileSync(errorPath));
  }

  return router.routes();
}

async function listPathsInDir(
  currentDir: string,
  ext: string,
  filesArray: string[] = [],
) {
  for await (const f of Deno.readDir(currentDir)) {
    const filePath = path.join(currentDir, f.name);
    if (f.isDirectory && !f.name.startsWith("_")) {
      await listPathsInDir(filePath, ext, filesArray);
      continue;
    }
    filesArray.push(filePath);
  }
  return filesArray.filter((f) => f.endsWith(ext));
}

function splitPagesAndErrors(pagesAndErrorsPaths: string[]) {
  const pagesPaths = pagesAndErrorsPaths.filter((f) => {
    const fileName = path.parse(f).name;
    return !fileName.startsWith("_");
  });
  const errorsPaths = pagesAndErrorsPaths.filter((f) =>
    f.endsWith("_404.njk") || f.endsWith("_500.njk")
  );
  return { pagesPaths, errorsPaths };
}

function convertToEndpoint(pagePath: string) {
  // Convert full page path to relative url and convert "/+" to Oak-friendly "/:".
  const endpoint = "/" + path.relative(pagesDir, pagePath).slice(0, -4); // ex: "about-us/history"
  return endpoint.replaceAll("/+", "/:");
}

async function getPageFromFiles(pathname) {
  let page;

  // Try to find file in pages dir – path.njk is prefered over path/index.njk
  const directAbsPath = path.join(pagesDir, pathname) + ".njk";
  page = await getPageObjectFromPagePath(directAbsPath);
  if (page) return [page];

  // Else, try to load path as dir/index.njk.
  const indexAbsPath = path.join(pagesDir, pathname) + "/index.njk";
  page = await getPageObjectFromPagePath(indexAbsPath);
  if (page) return [page];

  // Else, maybe one or more path segments are params like /books/123.
  const pagesArray = await glob("pages/**/*.{njk,ts}");
  const pathSegments = pathname.split("/").filter((p) => p !== "");
  const [paramsAbsPath, params] = findParamsAbsPath(pathSegments, pagesArray);
  page = await getPageObjectFromPagePath(paramsAbsPath);
  if (page) return [page, params];

  return [];
}

async function glob(globPattern) {
  const globResult = await expandGlob(globPattern);
  const files: string[] = [];
  for await (const file of globResult) {
    files.push(file.path);
  }
  return files;
}

function findParamsAbsPath(
  pathSegments: string[],
  pagesArray: string[],
  pathSoFar = pagesDir,
  params = {},
) {
  // Are we all out of path segments after recursing?
  if (pathSegments.length === 0) {
    // Check for direct or index paths.
    const directAbsPath = pathSoFar + ".njk";
    if (pagesArray.includes(directAbsPath)) return [directAbsPath, params];
    const indexAbsPath = pathSoFar + "/index.njk";
    if (pagesArray.includes(indexAbsPath)) return [indexAbsPath, params];

    // No direct or index paths found.
    return [];
  }

  // Remove the first segment and check if it matches a page.
  const nextSegment = pathSegments.shift() || "";
  const maybePathSoFar = path.join(pathSoFar, nextSegment);

  if (pagesArray.find((p) => p.startsWith(maybePathSoFar))) {
    // Matches, so update pathSoFar and keep going.
    pathSoFar = maybePathSoFar;
    return findParamsAbsPath(pathSegments, pagesArray, pathSoFar, params);
  }

  // Doesn't match so check for params placeholder
  const maybePathSoFarWithParams = path.join(pathSoFar, "+");
  const pathSoFarWithParams = pagesArray.find((p) =>
    p.startsWith(maybePathSoFarWithParams)
  );

  if (pathSoFarWithParams) {
    // Get segments of relative page page path.
    const remainderOfPath = path.relative(pathSoFar, pathSoFarWithParams);
    const remainerSegments = remainderOfPath.split("/").filter((p) => p !== "");
    const paramSegment = remainerSegments[0].replace(/.njk$/, "");
    pathSoFar = path.join(pathSoFar, paramSegment);
    const paramName = paramSegment.slice(1);
    params[paramName] = nextSegment;
    return findParamsAbsPath(pathSegments, pagesArray, pathSoFar, params);
  }

  return [];
}

async function getPageObjectFromPagePath(pagePath: string) {
  try {
    const templatePath = pagePath;
    const templateString = Deno.readTextFileSync(pagePath);
    const initFunction = await getInitFunction(templateString);
    return { templatePath, templateString, initFunction };
  } catch (_) {
    return null;
  }
}

async function getInitFunction(templateString: string) {
  // Parse Dom and find tags with z-init attribute.
  const dom = parseHTML(templateString);
  const initTags = dom["document"]?.querySelectorAll("[z-init]");
  // Default init function that just renders the page.
  const defaultInitFunction = (ctx) => ctx.render();
  // If no init tags, return default init function.
  if (!initTags || initTags.length < 1) return defaultInitFunction;

  // If more than one init tag, log error and continue.
  if (initTags?.length > 1) {
    logger.error(
      "Using first [z-init] tag and ignoring the rest. Found:",
      initTags,
    );
  }

  // If no z-init value is found, return default init function.
  const zInitValue = initTags[0]?.getAttribute("z-init")?.trim();
  if (!zInitValue) return defaultInitFunction;

  // Is there a custom action name?
  const [actionsModuleName, customInitMethodName] = zInitValue.split(".");
  const initMethodName = customInitMethodName
    ? `_${customInitMethodName}`
    : "_";

  // If this is dev mode, find init function in actions/ dir.
  if (env.DEV) {
    noCache++;
    const actionsModulePath = path.join(
      actionsDir,
      actionsModuleName + `.ts?no-cache=${noCache}`,
    );
    let actionsModuleObject;
    try {
      actionsModuleObject = await import("file://" + actionsModulePath);
      actionsModuleObject = actionsModuleObject.default; // actions modules always export default.
    } catch (error) {
      // Don't eat this error!
      logger.error(
        `Template contains [z-init="${zInitValue}"] but actions/${actionsModuleName}.ts failed to import\n\n${error.stack}`,
      );
    }
    if (!actionsModuleObject) return defaultInitFunction;

    // If no init function exists in actionsModuleObject, log error and return default init function.
    if (!actionsModuleObject[initMethodName]) {
      logger.error(
        `Template contains [z-init="${zInitValue}"] but no "${initMethodName}" method is defined in actions/${actionsModuleName}.ts`,
      );
      return defaultInitFunction;
    }

    // Return the init function.
    return actionsModuleObject[initMethodName];
  }

  // Not dev mode – so find init function in actionsCache.
  const cachedInitModule = actionsCache?.get(actionsModuleName);
  if (!cachedInitModule) {
    logger.error(
      `Template contains [z-init="${zInitValue}"] but no module exists at actions/${actionsModuleName}.ts`,
    );
    return defaultInitFunction;
  }
  const cachedInitFunction = cachedInitModule[initMethodName];
  if (!cachedInitFunction) {
    logger.error(
      `Template contains [z-init="${zInitValue}"] but no "${initMethodName}" method is defined in actions/${actionsModuleName}.ts`,
    );
    return defaultInitFunction;
  }
  return cachedInitFunction;
}

function getRoute(page) {
  return async (context: any) => {
    const ctx = getInitCtx(context, page);
    await page.initFunction(ctx, ctx.$);
    context.state.session.set("_state_", {
      $: ctx.$,
      $meta: ctx.$meta,
      page: ctx.page,
    });
  };
}

function getDefaultErrorTemplate(status: number): string {
  const errors = {
    404:
      '<div class="page container fade-in"><h2 class="h2">Not Found</h2></div>',
    500:
      '<div class="page container fade-in"><h2 class="h2">Internal Server Error</h2></div>',
  };
  return errors[status];
}
