import { env, MongoStore, Session } from "../deps.ts";
import { getDb } from "../mod.ts";

const db = await getDb();
const store = new MongoStore(db, "zenjs_sessions");

// Use in memory session store in dev mode, otherwise use MongoDB.
export const session = env.MODE === "dev"
  ? Session.initMiddleware()
  : Session.initMiddleware(store);
