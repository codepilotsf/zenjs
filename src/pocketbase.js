import { PocketBase, env } from "../deps.js";

export function getPocketbase() {
  const pocketbaseUrl = env.POCKETBASE_URL || "http://127.0.0.1:8090";
  return new PocketBase(pocketbaseUrl);
}