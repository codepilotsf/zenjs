/** Generate a 404/500 page using nearest 404/500 template for this request. */

import { getErrorTemplate, getInitCtx, logger, parseTemplate } from "../mod.js";

export async function error404(context) {
  const templateString = await getErrorTemplate(
    404,
    context.request.url.pathname,
  );

  const ctx = getInitCtx(context, { templateString });
  ctx.$["title"] = "Not Found";
  logger.request(`${reqType(ctx)} ${ctx.$meta.pathname}`);
  logger.error(
    `404 NOT FOUND: ${ctx.$meta.method.toUpperCase()} ${ctx.$meta.pathname}`,
  );

  context.response.status = 404;
  context.response.body = parseTemplate(
    ctx.page.templateString,
    ctx,
  ).toString();
}

export async function catch500(context, next) {
  console.log("got to catch500");

  try {
    await next();
  } catch (error) {
    const { file, line } = getFileAndLine(error.stack);
    error.file = file;
    error.line = line;
    const templateString = await getErrorTemplate(
      500,
      context.request.url.pathname,
    );

    const ctx = getInitCtx(context, { templateString });
    ctx.$["title"] = "Internal Server Error";
    ctx.$meta.error = error;
    logger.request(`${reqType(ctx)} ${ctx.$meta.pathname}`);
    logger.error(error.stack);
    context.response.status = 500;
    context.response.body = parseTemplate(
      ctx.page.templateString,
      ctx,
    ).toString();
  }
}

function reqType(ctx) {
  return ctx.$meta.headers["z-merge"] ? "MERGE" : "GET";
}

function getFileAndLine(stack) {
  // Parse the first file name and line number from the stack trace.
  const regex = /\((.*):(\d+):\d+\)$/;
  const lines = stack.split("\n");
  for (const line of lines) {
    if (line.includes("file://")) {
      const match = regex.exec(line);
      const fullFileString = (match && match[1]) || "";
      const fileStringParts = fullFileString.split(Deno.cwd());
      const fileName = fileStringParts.pop() || "";
      const lineNumber = (match && match[2]) || "";
      return { file: fileName, line: lineNumber };
    }
  }
  return {};
}
