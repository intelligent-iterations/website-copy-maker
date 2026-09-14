/**
 * Minimal structured logger. The agent loop prints concise progress; verbose
 * detail goes to a JSONL file under the run-state dir for later inspection.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = {
  readonly level: LogLevel;
  readonly time: string;
  readonly stage?: string;
  readonly msg: string;
  readonly data?: Readonly<Record<string, unknown>>;
};

export type Logger = {
  readonly child: (stage: string) => Logger;
  readonly debug: (msg: string, data?: Record<string, unknown>) => void;
  readonly info: (msg: string, data?: Record<string, unknown>) => void;
  readonly warn: (msg: string, data?: Record<string, unknown>) => void;
  readonly error: (msg: string, data?: Record<string, unknown>) => void;
};

export type LoggerSink = (record: LogRecord) => void;

export function createLogger(opts: {
  sink?: LoggerSink;
  stage?: string;
  minLevel?: LogLevel;
}): Logger {
  const sink = opts.sink ?? defaultSink;
  const stage = opts.stage;
  const minLevel = opts.minLevel ?? "info";
  const minRank = LEVEL_RANK[minLevel];

  const emit = (level: LogLevel, msg: string, data?: Record<string, unknown>): void => {
    if (LEVEL_RANK[level] < minRank) return;
    const record: LogRecord = stage
      ? data
        ? { level, time: new Date().toISOString(), stage, msg, data }
        : { level, time: new Date().toISOString(), stage, msg }
      : data
        ? { level, time: new Date().toISOString(), msg, data }
        : { level, time: new Date().toISOString(), msg };
    sink(record);
  };

  return {
    child: (childStage: string) =>
      createLogger({
        sink,
        stage: stage ? `${stage}.${childStage}` : childStage,
        minLevel,
      }),
    debug: (msg, data) => emit("debug", msg, data),
    info: (msg, data) => emit("info", msg, data),
    warn: (msg, data) => emit("warn", msg, data),
    error: (msg, data) => emit("error", msg, data),
  };
}

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function defaultSink(record: LogRecord): void {
  const stream =
    record.level === "error" || record.level === "warn" ? process.stderr : process.stdout;
  const stagePart = record.stage ? ` [${record.stage}]` : "";
  const dataPart = record.data ? " " + JSON.stringify(record.data) : "";
  stream.write(
    `${record.time} ${record.level.toUpperCase()}${stagePart} ${record.msg}${dataPart}\n`,
  );
}
