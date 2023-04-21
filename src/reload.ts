import { EventEmitter } from "../deps.ts";
export const reloadEmitter = new EventEmitter();

let timer;

export async function reload() {
  // Todo: Only watch dirs which exist (i.e. don't watch static if there's no static dir)
  for await (
    const { paths } of Deno.watchFs(["./pages", "./actions", "./static"])
  ) {
    triggerReload(paths[0]);
  }
  // Simple debounce because for some reason Deno watchFs sometimes fires 2 or 3 times.
  function triggerReload(path) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const isStatic = path.startsWith(Deno.cwd() + "/static");
      const reloadEvent = isStatic ? "relinkStaticResources" : "remergePage";
      // Emit an event to be picked up by Get, 404, and 500 route handlers.
      reloadEmitter.emit(reloadEvent);
    }, 20);
  }
}
