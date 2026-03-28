import winston, { LoggerOptions } from "winston";

/**
 * Create a logger instance following the project's logging patterns.
 * Uses winston with JSON formatting and pretty printing for console output.
 */
export function makeLogger(opts?: LoggerOptions): winston.Logger {
  const { combine, prettyPrint } = winston.format;
  const logger = winston.createLogger({
    format: combine(
      winston.format.timestamp({
        format: "YYYY-MM-DD HH:mm:ss",
      }),
      winston.format.errors({ stack: true }),
    ),
    transports: [
      new winston.transports.Console({
        format: combine(winston.format.json(), prettyPrint()),
      }),
    ],
    defaultMeta: { service: "api" },
    ...opts,
  });
  return logger;
}
