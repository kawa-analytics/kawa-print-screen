const winston = require('winston');
const debug = require('debug');
const config = require('./config.json');
require('winston-daily-rotate-file');

const { format, loggers, transports, addColors } = winston;
const { combine, timestamp, printf } = format;

const getPerfMarks = () => {
  const marks = {};

  const browser_launch = 'Launch_browser';
  marks.browser_launch = {
    name: browser_launch,
    start: `${browser_launch}:start`,
    end: `${browser_launch}:end`,
  };

  marks.getMarks = () => {
    return [[marks.browser_launch.name, marks.browser_launch.start, marks.browser_launch.end]];
  };

  return marks;
};

function initPerformanceLog() {
  return winston.createLogger({
    levels: { info: 0 },
    level: 'info',
    format: winston.format.json(),
    transports: [
      new winston.transports.File({
        filename: '/tmp/performance.log',
        level: 'info',
      }),
    ],
  });
}

function measure(marks) {
  const performanceLog = initPerformanceLog();
  if ('MEASURE' in process.env) {
    (marks ?? getPerfMarks()).forEach(([name, start, end]) => {
      const measure = performance.measure(name, start, end);
      performanceLog.info(`${name} took ${measure.duration}ms`);
    });
  }
}

function isLoggerType(str) {
  return str === 'info' || str === 'verbose' || str === 'debug';
}

let activeLogger = process.env.KAWA_NODE_LOG_LEVEL || 'info';
if (!isLoggerType(activeLogger)) {
  activeLogger = 'info';
}

const customDebugLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'grey',
  },
};

const logFilename = 'KAWA-NODE_combined-%DATE%.log';
const logDirname = config.logDirectory;

const fileRotateTransport = new transports.DailyRotateFile({
  filename: logFilename,
  dirname: logDirname,
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
});

function errorToString(err) {
  let text = err.stack;
  let e = err;

  while (e) {
    e = e.cause instanceof Error ? e.cause : null;
    if (e) text += `\n[Caused by] ` + e.stack;
  }

  return text;
}

const formatter = combine(
  timestamp({ format: 'MMM D, YYYY HH:mm:ss,SSS' }),
  format((info) => {
    const { perimeter, principal, trace, workspace } = info;

    info.context = `{perimeter=${perimeter}, principal=${principal}, request=${trace}, workspace=${workspace}}`;
    info.message =
      info.level === 'error' && info.message instanceof Error
        ? errorToString(info.message)
        : info.message;

    return info;
  })(),
  printf((info) => {
    const level = info.level.toUpperCase().padEnd(5, ' ');
    return `${info.timestamp} [ ${level} ] ${info.context} - ${info.service} - ${info.message}`;
  }),
);

loggers.add('info', {
  levels: customDebugLevels.levels,
  defaultMeta: {
    perimeter: 'N/A',
    principal: 5,
    trace: process.env.REQUEST_TRACE_ID || 'LOG_TRACE_ID_MUST_BE_HERE',
    workspace: 1,
  },
  format: formatter,
  transports: [fileRotateTransport],
  exceptionHandlers: [new transports.File({ filename: 'exceptions.log', dirname: logDirname })],
  rejectionHandlers: [new transports.File({ filename: 'rejections.log', dirname: logDirname })],
});

loggers.add('debug', {
  levels: customDebugLevels.levels,
  format: format.json(),
  transports: [
    new transports.Console({
      level: 'debug',
      format: combine(
        timestamp({ format: 'MMM D, YYYY HH:mm:ss,SSS' }),
        format((info) => {
          info.message =
            info.level === 'error' && info.message instanceof Error
              ? errorToString(info.message)
              : info.message;

          return info;
        })(),
        printf((info) => {
          const level = info.level.toUpperCase().padEnd(5, ' ');
          return `${info.timestamp} [ ${level} ] - ${info.message}`;
        }),
      ),
    }),
    /*new transports.File({
      level: 'debug',
      filename: '/tmp/debug.log',
    }),*/
  ],
});

addColors(customDebugLevels);

function getActiveLogger() {
  return loggers.get(activeLogger);
}

function setActiveLogger(loggerType) {
  if (!isLoggerType(loggerType)) {
    throw new Error("Active logger must be set to either 'info', 'verbose', or 'debug'");
  }
  activeLogger = loggerType;
}

module.exports = {
  getActiveLogger,
  setActiveLogger,
};
