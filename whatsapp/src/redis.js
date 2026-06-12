import Redis from 'ioredis';
import { config } from './config.js';

const options = {
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null,
};

export const redis = new Redis(options);
export const blockingRedis = new Redis(options);