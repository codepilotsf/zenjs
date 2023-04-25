import { env } from "../deps.js";
import { getErrorTemplate, logger, parseTemplate } from "../mod.js";

const noCache = Date.now();

export function getInitCtx(context, page) {
  // Create plain objects for $meta.query and $meta.headers.
  const query = {};
  const headers = {};
  context.request.url.searchParams.forEach((v, k) => (query[k] = v));
  context.request.headers.forEach((v, k) => (headers[k] = v));

  const ctx = {
    $: {},

    // $meta for template parsing but also make most props available directly on ctx.
    $meta: {
      dev: Boolean(env.DEV),
      error: {},
      flash: getFlashVals(context),
      hash: context.request.url.hash,
      headers: headers,
      host: context.request.url.host,
      hostname: context.request.url.hostname,
      href: context.request.url.href,
      ip: context.request.ip,
      method: context.request.method,
      nocache: noCache,
      params: context.params,
      pathname: context.request.url.pathname,
      port: context.request.url.port,
      protocol: context.request.url.protocol,
      query: query,
      search: context.request.url.search,
      secure: context.request.secure,
      session: {}, // Readonly session vals gets populated in parseLocals
    },

    dev: Boolean(env.DEV),
    hash: context.request.url.hash,
    headers: headers,
    host: context.request.url.host,
    hostname: context.request.url.hostname,
    href: context.request.url.href,
    ip: context.request.ip,
    method: context.request.method,
    nocache: noCache,
    params: context.params,
    pathname: context.request.url.pathname,
    port: context.request.url.port,
    protocol: context.request.url.protocol,
    query: query,
    search: context.request.url.search,
    secure: context.request.secure,

    page,

    session: context.state.session,

    elementsToModify: {},

    flash(name, value) {
      context.state.session.flash(name, value);
    },

    setHeader(name, value) {
      context.response.headers.set(name, value);
      return ctx;
    },

    redirect(url) {
      logger.request(`${reqType(ctx)} ${ctx.$meta.pathname} ▷ REDIRECT ${url}`);
      context.response.status = 204;
      if (context.request.headers.get("z-merge")) {
        context.response.headers.set("z-redirect", url);
        context.response.headers.set("z-replace-state", url);
      } else {
        context.response.redirect(url);
      }
    },

    render() {
      // Log except for dev reload.
      if (!context.request.headers.get("z-reload")) {
        logger
          ? logger.request(`${reqType(ctx)} ${ctx.$meta.pathname} ▷ RENDER`)
          : null;
      }
      const body = parseTemplate(ctx.page.templateString, ctx)?.toString();
      context.response.status = 200;
      context.response.headers.set("Content-Type", "text/html");
      context.response.body = body;
    },

    send(text) {
      logger.request(`DIRECT ${ctx.$meta.pathname} ▷ SEND`);
      context.response.body = text;
    },

    json(data) {
      logger.request(`DIRECT ${ctx.$meta.pathname} ▷ JSON`);
      ctx.setHeader("Content-Type", "application/json");
      context.response.body = data;
    },

    _404() {
      logger.request(`${reqType(ctx)} ${ctx.$meta.pathname} ▷ 404`);
      logger.error(`404 NOT FOUND: ${ctx.$meta.pathname}`);
      const template = getErrorTemplate(404, ctx.$meta.pathname);
      ctx.$["title"] = "Not Found";
      context.response.status = 404;
      context.response.body = parseTemplate(template, ctx).toString();
    },

    _500(name = "", message = "") {
      name = name ? `Error: ${name}` : "Internal Server Error";
      logger.request(`${reqType(ctx)} ${ctx.$meta.pathname} ▷ 500`);
      logger.error(`${name} ${message}`);
      const template = getErrorTemplate(500, ctx.$meta.pathname);
      ctx.$["title"] = "Internal Server Error";
      ctx.$meta.error = { name, message };
      context.response.status = 500;
      context.response.body = parseTemplate(template, ctx).toString();
    },

    next() {
      const nextInitFunction = page.initFunctionStack.shift();
      if (!nextInitFunction) {
        ctx._500("ctx.next() failed", "No next init function in stack.");
        return;
      }
      nextInitFunction(ctx);
    },
  };

  return ctx;
}

export function getActionCtx(context, action) {
  // Get the action name from query string.
  const searchParams = {};
  context.request.url.searchParams.forEach((v, k) => (searchParams[k] = v));
  const actionsMethod = Object.keys(searchParams)[0];
  const actionsModule = context.request.url.pathname.slice(3);

  const { $, page, $meta } = context.state.session.get("_state_");

  const { trigger, lastFocused, payload } = action;

  const ctx = {
    page,
    $,
    $meta,
    actionsMethod,
    actionsModule,
    trigger,
    lastFocused,
    payload,
    session: context.state.session,
    elementsToModify: {},

    // Make most $meta props from previous page request available directly on ctx for actions.
    hash: $meta.hash,
    headers: $meta.headers,
    host: $meta.host,
    hostname: $meta.hostname,
    href: $meta.href,
    ip: $meta.ip,
    method: $meta.method,
    mode: $meta.mode,
    params: $meta.params,
    pathname: $meta.pathname,
    port: $meta.port,
    protocol: $meta.protocol,
    query: $meta.query,
    search: $meta.search,
    secure: $meta.secure,

    flash(name, value) {
      context.state.session.flash(name, value);
    },

    render(elements) {
      if (!elements) {
        logger.error(
          `Missing required elements arg to render() in ${actionsModule}.${actionsMethod}`,
        );

        return;
      }
      // If elements is a single string, convert to array.
      elements = Array.isArray(elements) ? elements : [elements];

      // Render specified elements with Nunjucks.
      const elementsToRender = [];

      const dom = parseTemplate(ctx.page.templateString, ctx);

      // Create element strings to be rendered.
      elements.forEach((elementId) => {
        if (!isValidId(elementId)) return;
        const elementTemplate = dom.querySelector(elementId)?.outerHTML;
        if (!elementTemplate) {
          logger.error(
            `Unable to render element ${elementId} because it does not exist in template`,
          );

          return;
        }
        elementsToRender.push(elementTemplate);
      });

      // If there were any modifiers, we also need to send new twind styles.
      if (ctx.elementsToModify) {
        const twindStyles = dom.getElementById("__twind")?.outerHTML;
        elementsToRender.push(twindStyles);
        ctx.elementsToModify = {};
      }

      logger.request(
        ` ▷ ACTION ${actionsModule}.${actionsMethod} ▷ RENDER ${
          elements.join(
            ", ",
          )
        }`,
      );

      context.response.status = 200;
      context.response.headers.set("Content-Type", "text/html");
      context.response.body = elementsToRender.join("\n\n");
    },

    redirect(url) {
      logger.request(
        ` ▷ ACTION ${actionsModule}.${actionsMethod} ▷ REDIRECT ▷ ${url} `,
      );

      context.response.headers.set("z-redirect", url);
      context.response.status = 204;
    },

    _404() {
      logger.request(` ▷ ACTION ${actionsModule}.${actionsMethod} ▷ 404`);
      logger.error(`404 NOT FOUND: ${ctx.$meta.pathname}`);
      const template = getErrorTemplate(404, ctx.$meta.pathname);
      ctx.$["title"] = "Not Found";
      context.response.headers.set("z-error", true);
      context.response.status = 404;
      context.response.body = parseTemplate(template, ctx);
    },

    _500(name = "", message = "") {
      name = name ? `${name}` : "Internal Server Error";
      logger.request(` ▷ ACTION ${actionsModule}.${actionsMethod} ▷ 500`);
      logger.error(`${name} ${message}`);
      const template = getErrorTemplate(500, ctx.$meta.pathname);
      ctx.$["title"] = "Internal Server Error";
      ctx.$meta.error = { name, message };
      context.response.headers.set("z-error", true);
      context.response.status = 500;
      context.response.body = parseTemplate(template, ctx);
    },

    ignore() {
      logger.request(` ▷ ACTION ${actionsModule}.${actionsMethod} ▷ IGNORE`);
      context.response.status = 204;
    },

    withElement(elementId) {
      elementId = elementId.replace(/^#/, "");
      ctx.elementsToModify[elementId] = ctx.elementsToModify[elementId] || [];
      return {
        addClass(classes) {
          classes = Array.isArray(classes) ? classes : [classes];
          ctx.elementsToModify[elementId].push({
            type: "addClass",
            data: classes,
          });
          return this;
        },
        removeClass(classes) {
          classes = Array.isArray(classes) ? classes : [classes];
          ctx.elementsToModify[elementId].push({
            type: "removeClass",
            data: classes,
          });
          return this;
        },
        setAttr(attr, value) {
          ctx.elementsToModify[elementId].push({
            type: "setAttr",
            data: [attr, value],
          });
          return this;
        },
        removeAttr(attr) {
          ctx.elementsToModify[elementId].push({
            type: "removeAttr",
            data: [attr],
          });
          return this;
        },
      };
    },
  };

  return ctx;
}

function isValidId(id) {
  const isValid = /^#[A-Za-z]+[\w\-\:\.]*$/.test(id);
  if (!isValid) {
    logger.error(`Invalid id reference \`${id}\` used in action handler`);
  }
  return isValid;
}

function reqType(ctx) {
  return ctx.$meta.headers["z-merge"] ? "MERGE" : "DIRECT";
}

function getFlashVals(context) {
  const flashVals = {};
  Object.keys(context.state.session.data._flash).forEach((key) => {
    flashVals[key] = context.state.session.get(key);
  });
  return flashVals;
}

// function isValidClass(className) {
//   const isValid = /^\.-?[_a-zA-Z]+[_a-zA-Z0-9-\/]*$/.test(className);
//   if (!isValid) {
//     logger.error(
//       `Warning: Invalid CSS class reference \`${className}\` used in action handler`,
//     );
//   }
//   return isValid;
// }
