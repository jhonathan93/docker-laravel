import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { redis } from './redis.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { postToLaravel } from './laravel.js';
import { putBuffer } from './media.js';
import { extractText, detectMedia, extFor, audioMeta, encodeMessage } from './parse.js';

async function storeMedia(msg, media, sock) {
    const buffer = await downloadMediaMessage(
        msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage },
    );

    const mimetype = media.data.mimetype || 'application/octet-stream';
    const day = new Date().toISOString().slice(0, 10);
    const key = `${config.minio.prefix}/inbound/${day}/${msg.key.id}.${extFor(mimetype)}`;

    const { bucket } = await putBuffer(key, buffer, mimetype);

    return {
        type: media.type,
        bucket,
        key,
        mimetype,
        filename: media.data.fileName || null,
        size: buffer.length,
    };
}

export async function forwardToLaravel(msg, sock) {
    const id = msg.key.id;
    const fresh = await redis.set(`wa:seen:${id}`, '1', 'EX', config.dedupeTtlSec, 'NX');

    if (fresh !== 'OK') {
        logger.debug({ id }, 'Mensagem duplicada ignorada (idempotência).');
        return;
    }

    let mediaRef = null;
    const media = detectMedia(msg.message);

    if (media?.type === 'audio') {
        mediaRef = {
            type: 'audio',
            on_demand: true,
            downloaded: false,
            ...audioMeta(media.data),
            descriptor: encodeMessage(msg),
        };
    } else if (media) {
        try {
            mediaRef = await storeMedia(msg, media, sock);
        } catch (err) {
            logger.error({ err, id }, 'Falha ao baixar/subir mídia; encaminhando sem o arquivo.');
        }
    }

    await postToLaravel({
        event: 'message',
        wa_message_id: id,
        from: msg.key.remoteJid,
        push_name: msg.pushName || null,
        text: extractText(msg.message),
        media: mediaRef,
        timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
    });
}