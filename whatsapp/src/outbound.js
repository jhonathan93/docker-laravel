import { redis, blockingRedis } from './redis.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { getBuffer } from './media.js';
import { resolveJid } from './numbers.js';
import { postToLaravel } from './laravel.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);


function computeGap(text) {
    const { gapMinMs, gapMaxMs, charSaturation, jitterMs } = config.send;
    const len = (text || '').length;
    const factor = Math.min(len / charSaturation, 1); 
    const base = gapMinMs + factor * (gapMaxMs - gapMinMs); 
    const jitter = (Math.random() - 0.5) * jitterMs;
    return Math.round(clamp(base + jitter, gapMinMs, gapMaxMs));
}

async function buildContent(job) {
    if (!job.media) return { text: job.text };

    const { type, caption, filename, mimetype, key, url, ptt } = job.media;
    const buffer = key ? await getBuffer(key) : Buffer.from(await (await fetch(url)).arrayBuffer());

    switch (type) {
        case 'image':    return { image: buffer, caption };
        case 'video':    return { video: buffer, caption };
        case 'audio':    return { audio: buffer, mimetype: mimetype || 'audio/ogg; codecs=opus', ptt: ptt ?? false };
        case 'document': return { document: buffer, fileName: filename || 'arquivo', mimetype: mimetype || 'application/octet-stream', caption };
        default:         return { text: job.text || caption || '' };
    }
}

async function deliver(job, sock) {
    const gap = computeGap(job.text || job.media?.caption || '');

    if (config.send.typingIndicator && !job.media) {
        await sock.sendPresenceUpdate('composing', job.jid).catch(() => {});
        await sleep(gap);
        await sock.sendPresenceUpdate('paused', job.jid).catch(() => {});
    } else {
        await sleep(gap);
    }

    const content = await buildContent(job);
    await sock.sendMessage(job.jid, content);
    logger.info({ jid: job.jid, gap, media: job.media?.type || null }, 'Mensagem enviada.');
}

export async function startOutboundLoop(getSock) {
    logger.info(`Aguardando mensagens de saída em "${config.outboundKey}"...`);

    while (true) {
        let raw;

        try {
            const result = await blockingRedis.blpop(config.outboundKey, 0); 
            
            if (!result) continue;

            raw = result[1];

            const job = JSON.parse(raw);
            const sock = getSock();

            if (!sock) {
                await blockingRedis.lpush(config.outboundKey, raw);
                await sleep(1000);
                continue;
            }

            if (config.validateRecipient) {
                const jid = await resolveJid(sock, job.jid);

                if (!jid) {
                    logger.warn({ to: job.jid }, 'Destinatário não tem WhatsApp; descartando.');

                    await redis.rpush(config.outbound.deadLetterKey, JSON.stringify({
                        ...job, _error: 'recipient_not_on_whatsapp', _failedAt: Date.now(),
                    }));

                    await postToLaravel({ event: 'invalid_recipient', to: job.jid }).catch(() => {});

                    continue;
                }

                job.jid = jid;
            }

            try {
                await deliver(job, sock);
            } catch (sendErr) {
                await handleSendFailure(job, sendErr);
            }
        } catch (err) {
            logger.error({ err, raw }, 'Erro no loop de saída.');
            await sleep(1000);
        }
    }
}

async function handleSendFailure(job, sendErr) {
    const attempts = (job._attempts || 0) + 1;

    if (attempts < config.outbound.maxAttempts) {
        job._attempts = attempts;

        const backoff = config.outbound.retryBaseMs * attempts;

        logger.warn({ jid: job.jid, attempts, backoff, err: sendErr?.message }, 'Falha no envio; reententando.');

        await sleep(backoff);
        await blockingRedis.lpush(config.outboundKey, JSON.stringify(job));

        return;
    }

    logger.error({ jid: job.jid, attempts, err: sendErr?.message }, 'Falha definitiva; movendo para dead-letter.');

    await redis.rpush(config.outbound.deadLetterKey, JSON.stringify({
        ...job, _failedAt: Date.now(), _error: sendErr?.message ?? String(sendErr),
    }));
}