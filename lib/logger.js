const winston = require('winston');
winston.emitErrs = true;
const logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      level: 'info',
      handleExceptions: true,
      json: false,
      colorize: true,
      prettyPrint: true,
      silent: false,
      timestamp: false,
    }),
  ],
  exitOnError: false,
});
logger.stream = {
  write(message) {
    logger.info(message);
  },
};

module.exports = logger;
