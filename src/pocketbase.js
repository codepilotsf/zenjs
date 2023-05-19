import { env, PocketBase } from "../deps.js";

// export function getPB(_context) {
//   const pbInit = {};
//   const handler = {
//     get(_target, prop, _receiver) {
//       const pb = new PocketBase(
//         env.POCKETBASE_URL || "http://127.0.0.1:8090",
//       );
//       return pb[prop];
//     },
//   };
//   const pb = new Proxy(pbInit, handler);
//   return pb;
// }

export function getPocketbaseAndDb(context) {
  // Create a PocketBase instance for each request.
  const pb = new PocketBase(
    env.POCKETBASE_URL || "http://127.0.0.1:8090",
  );

  // Make ctx.pb.collection("foo") easily available as ctx.db.foo.
  const dbInit = {};
  const handler = {
    get(_target, prop, _receiver) {
      const collectionName = String(prop);
      return pb.collection(collectionName);
    },
  };
  const db = new Proxy(dbInit, handler);
  return { pb, db };
}

export async function authRefresh(pb, context) {
  // Following this pattern: https://github.com/pocketbase/js-sdk#ssr-integration
  // 1. Load the authStore data from request cookie string.
  pb.authStore.loadFromCookie(
    context.request.headers.get("cookie") || "",
  );
  // 2. Try to get up-to-date auth store state by verifying and refreshing the loaded auth model (if any).
  try {
    pb.authStore.isValid &&
      await pb.collection("users").authRefresh();
  } catch (_) {
    pb.authStore.clear();
  }
  // 3. Send back the default 'pb_auth' cookie to the client with the latest authStore state.
  context.response.headers.set(
    "set-cookie",
    pb.authStore.exportToCookie(),
  );
}
