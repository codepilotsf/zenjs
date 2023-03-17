// Set configs at module level for life of server.

let config = {};
console.log("config:", config);
export function setConfig(obj) {
  config = { ...config, ...obj };
}

export function getConfig() {
  console.log("config:", config);
  return config;
}
