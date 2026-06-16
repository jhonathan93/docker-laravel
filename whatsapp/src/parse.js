import { proto } from '@whiskeysockets/baileys';

const MEDIA_NODES = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    documentMessage: 'document',
    stickerMessage: 'sticker',
};

const EXT = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf',
};

export function extFor(mimetype) {
    if (!mimetype) return 'bin';
    if (EXT[mimetype]) return EXT[mimetype];

    return mimetype.split('/')[1]?.split(';')[0] || 'bin';
}

export function detectMedia(message) {
    for (const [node, type] of Object.entries(MEDIA_NODES)) {
        if (message?.[node]) return { type, data: message[node] };
    }

    return null;
}

export function extractText(message) {
    if (!message) return '';

    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        ''
    );
}

function toNumber(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v.toNumber === 'function') return v.toNumber();

    const n = Number(v.toString?.() ?? v);
    return Number.isFinite(n) ? n : null;
}

export function audioMeta(data) {
    return {
        mimetype: data.mimetype || null,
        seconds: data.seconds ?? null,
        ptt: Boolean(data.ptt),
        size: toNumber(data.fileLength),
    };
}

export function encodeMessage(msg) {
    return Buffer.from(proto.WebMessageInfo.encode(msg).finish()).toString('base64');
}

export function decodeMessage(b64) {
    return proto.WebMessageInfo.decode(Buffer.from(b64, 'base64'));
}