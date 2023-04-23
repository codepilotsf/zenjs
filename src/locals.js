import { env, marked, nunjucks, parseHTML } from '../deps.js';
import { markdown } from '../mod.js';

// Configure Nunjucks and get the environment.
const noCache = env.DEV ? true : false;
const nunjucksEnv = nunjucks.configure('pages', { autoescape: true, noCache });

// Add the markdown extension.
nunjucksEnv.addExtension('markdown', new markdown(nunjucksEnv, marked));

// Add custom Nunjucks filters here if there's a nunjucks config file.
let extendNunjucks;
try {
  const pathToNunjucks = 'file://' + Deno.cwd() + '/config/nunjucks.config.js';
  extendNunjucks = (await import(pathToNunjucks)).extendNunjucks;
  extendNunjucks(nunjucksEnv);
} catch (_) {
  /* ignore */
}

// Export parseLocals to parse the template and return the document.
export function parseLocals(template, ctx) {
  const { $, $meta } = ctx;
  // Update $meta.session to latest session values.
  // We do this here in case the user has modified the session values in mount or custom actions.
  $meta.session = getSessionVals(ctx.session);
  const rendered = nunjucksEnv.renderString(template, { ...$, $meta });
  const parsedHTML = parseHTML(rendered);
  return parsedHTML['document'];
}

function getSessionVals(session) {
  // Session values include a bunch of meta things like _flash, _csrf, etc. We only want to return the actual session
  // values that the user has set so we skip keys that start with an underscore.
  const sessionVals = {};
  Object.keys(session.data)
    .filter((key) => !key.startsWith('_'))
    .forEach((key) => {
      sessionVals[key] = session.get(key);
    });

  return sessionVals;
}
