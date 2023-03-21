// import { env, MongoStore, Session } from "../deps.ts";
// import { getDb } from "../mod.ts";

// const db = await getDb();
// const store = new MongoStore(db, "zenjs_sessions");

import { connect, env, RedisStore, Session } from "../deps.ts";
import { logger } from "./logger.ts";

export const session = env.DEV
  ? Session.initMiddleware()
  : Session.initMiddleware(await getRedisStore());

async function getRedisStore() {
  try {
    // Create a redis connection
    const redis = await connect({
      hostname: "0.0.0.0",
      port: 6379,
    });
    console.log("Redis connected for sessions");
    return new RedisStore(redis);
  } catch (error) {
    logger.error("Failed to get Redis store for sessions\n" + error);
  }
}
