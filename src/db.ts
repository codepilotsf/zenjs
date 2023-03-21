import { env, MongoClient } from "../deps.ts";
import { logger } from "../mod.ts";

let db;

export async function getDb() {
  // Return existing connection?
  if (db) return db;

  if (!env.MONGO_URI) return;

  const client = new MongoClient();

  try {
    await client.connect(env.MONGO_URI);
    return client.database();
  } catch (error) {
    logger.error("Connection to MongoDB failed");
    throw error;
  }
}
