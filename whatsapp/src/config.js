export const config = {
    redis: {
        host: process.env.REDIS_HOST || 'redis',
        port: Number(process.env.REDIS_PORT || 6379),
    },

    outboundKey: process.env.WA_OUTBOUND_KEY || 'wa:outbound',
    webhookUrl: process.env.LARAVEL_WEBHOOK_URL || 'http://app/api/whatsapp/webhook',
    webhookSecret: process.env.WEBHOOK_SECRET || '',

    authDir: process.env.AUTH_DIR || './auth',

    logLevel: process.env.LOG_LEVEL || 'info',

    send: {
        gapMinMs: Number(process.env.WA_SEND_GAP_MIN_MS || 3000),
        gapMaxMs: Number(process.env.WA_SEND_GAP_MAX_MS || 8000),
        charSaturation: Number(process.env.WA_SEND_CHAR_SATURATION || 280),
        jitterMs: Number(process.env.WA_SEND_JITTER_MS || 1500),
        typingIndicator: (process.env.WA_TYPING_INDICATOR || 'true') !== 'false',
    },

    http: {
        port: Number(process.env.HTTP_PORT || 3000),
    },

    dedupeTtlSec: Number(process.env.WA_DEDUPE_TTL || 3600),

    outbound: {
        deadLetterKey: process.env.WA_DEADLETTER_KEY || 'wa:outbound:dead',
        maxAttempts: Number(process.env.WA_MAX_SEND_ATTEMPTS || 3),
        retryBaseMs: Number(process.env.WA_RETRY_BASE_MS || 2000),
    },

    reconnect: {
        baseMs: Number(process.env.WA_RECONNECT_BASE_MS || 3000),
        maxMs: Number(process.env.WA_RECONNECT_MAX_MS || 60000),
    },

    minio: {
        endpoint: process.env.MINIO_ENDPOINT || 'minio',
        port: Number(process.env.MINIO_PORT || 9000),
        useSSL: (process.env.MINIO_USE_SSL || 'false') === 'true',
        accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
        secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
        region: process.env.MINIO_REGION || 'us-east-1',
        bucket: process.env.MINIO_BUCKET || 'laravel',
        prefix: process.env.WA_MEDIA_PREFIX || 'whatsapp',
    },

    validateRecipient: (process.env.WA_VALIDATE_RECIPIENT || 'true') !== 'false',

    lookup: {
        cacheTtlSec: Number(process.env.WA_JID_CACHE_TTL || 604800),
        negativeTtlSec: Number(process.env.WA_JID_NEG_TTL || 86400),
    },

    avatar: {
        cacheTtlSec: Number(process.env.WA_AVATAR_TTL || 86400),
        negativeTtlSec: Number(process.env.WA_AVATAR_NEG_TTL || 21600),
    },

    history: {
        syncFull: (process.env.WA_SYNC_FULL_HISTORY || 'false') === 'true',
        listKey: process.env.WA_HISTORY_LIST || 'wa:history',
        namesKey: process.env.WA_HISTORY_NAMES || 'wa:history:names',
        metaKey: process.env.WA_HISTORY_META || 'wa:history:meta',
    },
};