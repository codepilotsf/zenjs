// import { env, MongoStore, Session } from "../deps.ts";
// import { getDb } from "../mod.ts";

// const db = await getDb();
// const store = new MongoStore(db, "zenjs_sessions");

import { connect, env, RedisStore, Session } from "../deps/mod.ts";

// Create a redis connection
const redis = await connect({
  hostname: "0.0.0.0",
  port: 6379,
});

// pass redis connection into a new RedisStore. Optionally add a second string argument for a custom database prefix, default is 'session_'
const store = new RedisStore(redis);

// Use in memory session store in dev mode, otherwise use MongoDB.
export const session = env.MODE === "dev"
  ? Session.initMiddleware()
  : Session.initMiddleware(store);
