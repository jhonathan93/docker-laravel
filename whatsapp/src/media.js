import * as Minio from 'minio';
import { config } from './config.js';
import { logger } from './logger.js';

export const minio = new Minio.Client({
    endPoint: config.minio.endpoint,
    port: config.minio.port,
    useSSL: config.minio.useSSL,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
});

export async function ensureBucket() {
    const exists = await minio.bucketExists(config.minio.bucket).catch(() => false);

    if (!exists) {
        await minio.makeBucket(config.minio.bucket, config.minio.region);
        logger.info({ bucket: config.minio.bucket }, 'Bucket MinIO criado.');
    }
}

export async function putBuffer(key, buffer, mimetype) {
    await minio.putObject(config.minio.bucket, key, buffer, buffer.length, {
        'Content-Type': mimetype || 'application/octet-stream',
    });

    return { bucket: config.minio.bucket, key };
}

export async function getBuffer(key) {
    const stream = await minio.getObject(config.minio.bucket, key);
    const chunks = [];

    for await (const chunk of stream) chunks.push(chunk);
    
    return Buffer.concat(chunks);
}