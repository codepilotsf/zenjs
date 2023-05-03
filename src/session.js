// import { env, MongoStore, Session } from "../deps.js";
// import { getDb } from "../mod.ts";

// const db = await getDb();
// const store = new MongoStore(db, "zenjs_sessions");

import { connect, env, MemoryStore, RedisStore, Session } from "../deps.js";
import { logger } from "./logger.js";

const expiration = 60 * 60 * 24 * 14; // 14 days

export const session = env.DEV
  ? Session.initMiddleware(new MemoryStore(), {
    expireAfterSeconds: expiration,
  })
  : Session.initMiddleware(await getRedisStore(), {
    expireAfterSeconds: expiration,
  });

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
