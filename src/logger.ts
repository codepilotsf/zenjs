import { colors, log } from "../deps.ts";

// custom configuration with 2 loggers (the default and `tasks` loggers)
await log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler("DEBUG"),
    // file: new log.handlers.FileHandler("WARNING", {
    //   filename: "./log.txt",
    //   // you can change format of output message using any keys in `LogRecord`
    //   formatter: "{levelName} {msg}",
    // }),
  },

  loggers: {
    // default: {
    //   level: "DEBUG",
    //   handlers: ["console"],
    // },

    dev: {
      level: "DEBUG",
      handlers: ["console", "file"],
    },
  },
});

// Get logger
let logger; // TODO: Get default logger.

// if (env.DEV) {
logger = log.getLogger("dev");
logger.request = (message: string) => {
  console.log(colors.gray(message));
  // };
};
export { logger };
