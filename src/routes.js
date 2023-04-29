import { env, expandGlob, path } from "../deps.js";
import {
  getActionCtx,
  getInitCtx,
  logger,
  parseInits,
  reloadEmitter,
} from "../mod.js";

// Cache pages, actions, and errors (not used for dev mode).
const pagesCache = new Map();
const actionsCache = new Map();
const errorsCache = new Map();
const validRelativeUrlRE = /^\/(?:[a-zA-Z\-\$_/\.:]+\/)*[a-zA-Z\-\$_/\.:]*$/;

const pagesDir = path.join(Deno.cwd(), "pages");
const actionsDir = path.join(Deno.cwd(), "actions");

let noCache = 0;

export function getRoutes(Router) {
  const router = new Router();
  return env.DEV ? getRoutesFromFiles(router) : getRoutesFromCache(router);
}

export async function getErrorTemplate(status, url, urlParts) {
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
    } catch (_) {
      /* ignore */
    }
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
    const isHidden = pathname
      .split("/")
      .filter((f) => f.startsWith("_")).length;
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

    // Page was found. Get ctx, save the _state_ to session, and render with next init function in stack.
    const ctx = getInitCtx(context, page);
    context.state.session.set("_state_", {
      $: ctx.$,
      $meta: ctx.$meta,
      page: ctx.page,
    });
    await ctx.next(ctx);
  });

  // ## ACTIONS ##

  // Create route for on demand actions.
  router.post("/@/(.*)", async (context, next) => {
    noCache++;
    const relativePath = context.request.url.pathname.slice(3);
    const jsRelativePath = relativePath + ".js";
    const tsRelativePath = relativePath + ".ts";

    // If any part of path starts with "_", skip it.
    const isHidden = relativePath
      .split("/")
      .filter((f) => f.startsWith("_")).length;
    if (isHidden) {
      await next();
      return;
    }

    const submitted = context.request.body();
    const { trigger, lastFocused, payload } = await submitted.value;
    const action = { trigger, lastFocused, payload };
    const ctx = getActionCtx(context, action);

    const jsActionsAbsPath = path.join(actionsDir, jsRelativePath);
    let jsActionsModule;
    try {
      const importPathToActionsModule =
        `file://${jsActionsAbsPath}?nocache=${noCache}`;
      jsActionsModule = await import(importPathToActionsModule);
    } catch (_) {
      /* ignore */
    }

    const tsActionsAbsPath = path.join(actionsDir, tsRelativePath);
    let tsActionsModule;
    try {
      const importPathToActionsModule =
        `file://${tsActionsAbsPath}?nocache=${noCache}`;
      tsActionsModule = await import(importPathToActionsModule);
    } catch (_) {
      /* ignore */
    }

    const actionsModule = jsActionsModule || tsActionsModule;

    if (!actionsModule) {
      logger.error(
        `No actions module found at /actions/${relativePath}.js/.ts`,
      );
      ctx.ignore();
      return;
    }

    if (!actionsModule?.default[ctx.actionsMethod]) {
      logger.error(
        `No action "${ctx.actionsMethod}" found in: /actions/${relativePath}.js/.ts`,
      );

      ctx.ignore();
      return;
    }
    await actionsModule.default[ctx.actionsMethod](ctx, ctx.$);
  });

  // Add a listener for devReload SSE?
  let isFreshServerStart = true;
  router.get("/__reload", (context) => {
    try {
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
    } catch (_) {
      /* ignore */
    }
  });
  return router.routes();
}

// Return routes for pages and actions cached at server start time (for non-dev mode).
async function getRoutesFromCache(router) {
  // For all other enviroments cache: pagesPaths, errorsPaths, and actionsPaths.
  const pagesAndErrorsPaths = await listPathsInDir(pagesDir, ".njk");
  const { pagesPaths, errorsPaths } = splitPagesAndErrors(pagesAndErrorsPaths);
  const jsActionsPaths = await listPathsInDir(actionsDir, ".js");
  const tsActionsPaths = await listPathsInDir(actionsDir, ".ts");
  const actionsPaths = [...jsActionsPaths, ...tsActionsPaths];

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
        logger.error("No actions module found for: /actions/" + actionsModule);

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

async function listPathsInDir(currentDir, ext, filesArray = []) {
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

function splitPagesAndErrors(pagesAndErrorsPaths) {
  const pagesPaths = pagesAndErrorsPaths.filter((f) => {
    const fileName = path.parse(f).name;
    return !fileName.startsWith("_");
  });
  const errorsPaths = pagesAndErrorsPaths.filter(
    (f) => f.endsWith("_404.njk") || f.endsWith("_500.njk"),
  );

  return { pagesPaths, errorsPaths };
}

function convertToEndpoint(pagePath) {
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
  const pagesArray = await glob("pages/**/*.{njk,js,ts}");
  const pathSegments = pathname.split("/").filter((p) => p !== "");
  const [paramsAbsPath, params] = findParamsAbsPath(pathSegments, pagesArray);
  page = await getPageObjectFromPagePath(paramsAbsPath);
  if (page) return [page, params];

  return [];
}

async function glob(globPattern) {
  const globResult = await expandGlob(globPattern);
  const files = [];
  for await (const file of globResult) {
    files.push(file.path);
  }
  return files;
}

function findParamsAbsPath(
  pathSegments,
  pagesArray,
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

async function getPageObjectFromPagePath(pagePath) {
  let templateString, _404String, _500String;
  try {
    templateString = Deno.readTextFileSync(pagePath);
    _404String = await getErrorTemplate(404, pagePath);
    _500String = await getErrorTemplate(500, pagePath);
  } catch (_) {
    return null;
  }
  const initFunctionStack = await getInitFunctionStack(templateString);
  return {
    templatePath: pagePath,
    templateString,
    _404String,
    _500String,
    initFunctionStack,
  };
}

async function getInitFunctionStack(templateString) {
  // Parse Dom and find tags with z-init attribute.
  const initTags = parseInits(templateString);

  // Define a default init function that just renders the page.
  const defaultInitFunction = (ctx) => ctx.render();

  // If no init tags, return stack with only the default init function.
  if (!initTags || initTags.length < 1) return [defaultInitFunction];

  // If one or more init tags, return a stack of init functions in order as they appear in the DOM.
  const initFunctionStack = [];
  for (const initTag of initTags) {
    // If no z-init value is found, return default init function.
    const zInitValue = initTag?.getAttribute("z-init")?.trim();
    if (!zInitValue) {
      logger.error(
        `Template contains [z-init] action module name is assigned`,
      );
      initFunctionStack.push(defaultInitFunction);
      break;
    }

    // Is there a custom init action name?
    const [actionsModuleName, customInitFunctionName] = zInitValue.split(".");
    const initFunctionName = customInitFunctionName
      ? `_${customInitFunctionName}`
      : "_";

    // Get the actions module from files or cache.
    const actionsModule = env.DEV
      ? await getActionsModuleFromFiles(actionsModuleName)
      : actionsCache?.get(actionsModuleName);

    // If no actions module is found, add the default init function.
    if (!actionsModule) {
      logger.error(
        `Template contains [z-init="${zInitValue}"] but no module exists at actions/${actionsModuleName}.js|ts`,
      );
      initFunctionStack.push(defaultInitFunction);
      break;
    }

    // If no init method is found in actions module, add the default init function.
    const initFunction = actionsModule[initFunctionName];
    if (!initFunction) {
      logger.error(
        `Template contains [z-init="${zInitValue}"] but no "${initFunctionName}" method is defined in actions/${actionsModuleName}.js|ts`,
      );
      initFunctionStack.push(defaultInitFunction);
      break;
    }

    // Add init method to stack and continue looping.
    initFunctionStack.push(initFunction);
  }
  return initFunctionStack;
}

async function getActionsModuleFromFiles(actionsModuleName) {
  // For dev mode, find module in actions/ dir.
  noCache++;

  // Look for .js file.
  const jsActionsModulePath = path.join(
    actionsDir,
    actionsModuleName + `.js?no-cache=${noCache}`,
  );
  let jsActionsModuleObject;
  try {
    jsActionsModuleObject = await import("file://" + jsActionsModulePath);
    return jsActionsModuleObject.default;
  } catch (_) { /* ignore */ }

  // Look for .ts file.
  const tsActionsModulePath = path.join(
    actionsDir,
    actionsModuleName + `.ts?no-cache=${noCache}`,
  );
  let tsActionsModuleObject;
  try {
    tsActionsModuleObject = await import("file://" + tsActionsModulePath);
    return tsActionsModuleObject.default;
  } catch (_) { /* ignore */ }

  // No module found.
  return null;
}

function getRoute(page) {
  return async (context) => {
    const ctx = getInitCtx(context, page);
    await page.initFunctionStack[0](ctx, ctx.$);
    context.state.session.set("_state_", {
      $: ctx.$,
      $meta: ctx.$meta,
      page: ctx.page,
    });
  };
}

function getDefaultErrorTemplate(status) {
  const errors = {
    404:
      '<div class="page container fade-in"><h2 class="h2">Not Found</h2></div>',
    500:
      '<div class="page container fade-in"><h2 class="h2">Internal Server Error</h2></div>',
  };
  return errors[status];
}
