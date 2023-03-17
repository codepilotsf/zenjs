import { env, MongoClient } from "../deps.ts";
import { logger } from "../mod.ts";

let db;

export async function getDb() {
  // Return existing connection?
  if (db) return db;

  const MONGO_URI = env.MONGO_URI;
  if (!MONGO_URI) throw new Error("MONGO_URI not found in .env");

  const client = new MongoClient();

  try {
    await client.connect(MONGO_URI);
    return client.database();
  } catch (error) {
    logger.error("Connection to MongoDB failed");
    throw error;
  }
}
