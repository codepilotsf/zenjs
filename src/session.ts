import { env, MongoStore, Session } from "../deps.ts";
import { getDb } from "../mod.ts";

let session;
if (env.MODE !== "live") {
  session = Session.initMiddleware();
} else {
  const db = await getDb();
  const store = new MongoStore(db, "zenjs_sessions");
  session = Session.initMiddleware(store);
}

export { session };
