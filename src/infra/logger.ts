import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'ogun', env: config.ogunEnv },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
