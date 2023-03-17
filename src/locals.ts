import { marked, nunjucks, parseHTML } from "../deps.ts";
import { markdown } from "../mod.ts";

// Configure Nunjucks and get the environment.
const env = nunjucks.configure("pages", { autoescape: true });

// Add the markdown extension.
env.addExtension("markdown", new markdown(env, marked));

// Add custom Nunjucks filters here if there's a top-level file called nunjucks.ts.
let extendNunjucks;
try {
  extendNunjucks = (await import(Deno.cwd() + "/nunjucks.ts")).extendNunjucks;
} catch (_) { /* ignore */ }
extendNunjucks(env);

// Export parseLocals to parse the template and return the document.
export function parseLocals(template, ctx) {
  const { $, $meta } = ctx;
  // Update $meta.session to latest session values.
  // We do this here in case the user has modified the session values in mount or custom actions.
  $meta.session = getSessionVals(ctx.session);
  const rendered = env.renderString(template, { ...$, $meta });
  const parsedHTML = parseHTML(rendered);
  return parsedHTML["document"];
}

function getSessionVals(session) {
  // Session values include a bunch of meta things like _flash, _csrf, etc. We only want to return the actual session
  // values that the user has set so we skip keys that start with an underscore.
  const sessionVals = {};
  Object.keys(session.data).filter((key) => !key.startsWith("_")).forEach(
    (key) => {
      sessionVals[key] = session.get(key);
    },
  );
  return sessionVals;
}
