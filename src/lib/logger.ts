import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level: LOG_LEVEL,
  transport:
    process.env.APP_ENV !== "production"
      ? {
          target: "pino/file",
          options: { destination: 1 }, // stdout
        }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
