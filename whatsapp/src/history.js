import { redis } from './redis.js';
import { config } from './config.js';
import { state } from './state.js';
import { logger } from './logger.js';
import { extractText, detectMedia, mediaMeta, encodeMessage } from './parse.js';

function normalizeMessage(m) {
    const media = detectMedia(m.message);
    let mediaRef = null;

    // Toda mídia do histórico é guardada como referência (descritor) e baixada
    // sob demanda — baixar tudo no sync seria inviável e a URL do WhatsApp expira.
    if (media) {
        mediaRef = {
            type: media.type,
            on_demand: true,
            downloaded: false,
            ...mediaMeta(media),
            descriptor: encodeMessage(m),
        };
    }

    return {
        wa_message_id: m.key?.id ?? null,
        jid: m.key?.remoteJid ?? null,
        from_me: Boolean(m.key?.fromMe),
        push_name: m.pushName || null,
        type: media ? media.type : 'text',
        text: extractText(m.message),
        has_media: Boolean(media),
        media: mediaRef,
        timestamp: Number(m.messageTimestamp) || null,
    };
}

const chatName = (c) => c.name || c.subject || null;
const contactName = (ct) => ct.name || ct.notify || ct.verifiedName || null;

/**
 * Persiste nomes de contatos no hash de nomes (jid → nome). Alimentado pelos
 * eventos contacts.upsert/update — é por aqui que vêm os nomes da agenda, que
 * o history sync não traz para contatos individuais.
 */
export async function rememberContacts(contacts = []) {
    const pipeline = redis.pipeline();
    let n = 0;

    for (const ct of contacts) {
        const name = contactName(ct);
        if (ct.id && name) {
            pipeline.hset(config.history.namesKey, ct.id, name);
            n++;
        }
    }

    if (n > 0) {
        await pipeline.exec();
        logger.info({ contacts: n }, 'Nomes de contatos atualizados.');
    }
}

export async function forwardHistory({ chats = [], contacts = [], messages = [], isLatest, progress, syncType }) {
    const msgs = messages.filter((m) => m?.message);
    const pipeline = redis.pipeline();

    for (const m of msgs) {
        pipeline.rpush(config.history.listKey, JSON.stringify(normalizeMessage(m)));
    }

    for (const c of chats) {
        const name = chatName(c);
        if (c.id && name) pipeline.hset(config.history.namesKey, c.id, name);
    }

    for (const ct of contacts) {
        const name = contactName(ct);
        if (ct.id && name) pipeline.hset(config.history.namesKey, ct.id, name);
    }

    await pipeline.exec();

    state.history = { progress: progress ?? null, is_latest: Boolean(isLatest), at: Date.now() };

    if (isLatest) {
        const total = await redis.llen(config.history.listKey);
        await redis.set(config.history.metaKey, JSON.stringify({ total, ready: true, at: Date.now() }));
        logger.info({ total, syncType }, 'History sync finalizado — buffer pronto no Redis.');
    } else {
        logger.info({ chunkMessages: msgs.length, progress }, 'History chunk bufferado no Redis.');
    }
}