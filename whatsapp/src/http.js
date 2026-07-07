import http from 'node:http';
import QRCode from 'qrcode';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { logger } from './logger.js';
import { state } from './state.js';
import { redis } from './redis.js';
import { registerOnDemand } from './onDemand.js';
import { resolveJid } from './numbers.js';
import { decodeMessage, detectMedia, extFor } from './parse.js';
import { putBuffer } from './media.js';

// Sentinela de cache negativo para foto de perfil (sem foto / privada).
const AVATAR_NONE = '-';

function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

function readJson(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (c) => { data += c; });
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } });
        req.on('error', () => resolve(null));
    });
}

function html(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
}

export function startHttpServer() {
    const server = http.createServer(async (req, res) => {
        const path = (req.url || '/').split('?')[0];

        if (path === '/health') return json(res, 200, { status: 'ok' });

        if (path === '/status') {
            return json(res, 200, {
                connected: state.connected,
                jid: state.jid,
                uptime_s: Math.floor((Date.now() - state.startedAt) / 1000),
                has_qr: Boolean(state.qr),
                qr_image: state.qr ? await QRCode.toDataURL(state.qr, { width: 320, margin: 2 }) : null,
                last_disconnect: state.lastDisconnect,
                reconnect_attempts: state.reconnectAttempts,
                blocked: state.blocked,
                blocked_reason: state.blockedReason,
                history: state.history,
            });
        }

        if (path === '/qr') {
            if (state.connected) return html(res, 200, '<p style="font-family:sans-serif">✅ Já conectado.</p>');
            if (!state.qr) return html(res, 503, '<p style="font-family:sans-serif">QR ainda não disponível. Recarregue em instantes…</p>');

            try {
                const dataUrl = await QRCode.toDataURL(state.qr, { width: 320, margin: 2 });

                return html(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp QR</title></head>
                    <body style="font-family:sans-serif;text-align:center;padding:2rem">
                    <h3>Escaneie em WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho</h3>
                    <img src="${dataUrl}" alt="QR code" width="320" height="320">
                    <p><small>A página recarrega sozinha; o QR expira em ~20s.</small></p>
                    <script>setTimeout(() => location.reload(), 20000)</script>
                    </body></html>`
                );
            } catch (err) {
                logger.error({ err }, 'Falha ao renderizar o QR.');
                return json(res, 500, { error: 'qr render failed' });
            }
        }

        // Download de mídia sob demanda (ex.: áudio). Recebe o descritor (proto
        // base64) salvo no Laravel, baixa do WhatsApp e sobe pro MinIO.
        // SECURITY: autenticação por segredo removida temporariamente (fase de
        // desenvolvimento). Reativar o guard X-Webhook-Secret antes de produção.
        if (path === '/media/fetch' && req.method === 'POST') {
            if (!state.connected || !state.sock) return json(res, 503, { error: 'not connected' });

            const body = await readJson(req);
            if (!body?.descriptor) return json(res, 400, { error: 'descriptor required' });

            try {
                const msg   = decodeMessage(body.descriptor);
                const media = detectMedia(msg.message);

                if (!media) return json(res, 422, { error: 'no media in descriptor' });

                const buffer = await downloadMediaMessage(
                    msg, 'buffer', {}, { logger, reuploadRequest: state.sock.updateMediaMessage },
                );

                const mimetype = media.data.mimetype || 'application/octet-stream';
                const id       = msg.key?.id || Date.now().toString();
                const key      = `${config.minio.prefix}/ondemand/${media.type}/${id}.${extFor(mimetype)}`;

                const { bucket } = await putBuffer(key, buffer, mimetype);

                return json(res, 200, { bucket, key, mimetype, size: buffer.length });
            } catch (err) {
                logger.error({ err }, 'Falha ao baixar mídia sob demanda (pode ter expirado no WhatsApp).');
                return json(res, 502, { error: 'download failed' });
            }
        }

        if (path === '/logout' && req.method === 'POST') {
            if (!state.sock) return json(res, 503, { error: 'not connected' });

            try {
                await state.sock.logout();
                return json(res, 200, { ok: true });
            } catch (err) {
                logger.error({ err }, 'Falha ao desconectar (logout).');
                return json(res, 500, { error: 'logout failed' });
            }
        }

        // Foto de perfil sob demanda. Resolve a URL via Baileys, baixa e sobe pro
        // MinIO, cacheando a key no Redis. Cache negativo p/ quem não tem foto
        // ou restringiu por privacidade (evita repetir a chamada ao WhatsApp).
        if (path === '/avatar') {
            const jid = new URL(req.url, 'http://x').searchParams.get('jid');

            if (!jid) return json(res, 400, { error: 'jid required' });
            if (!state.connected || !state.sock) return json(res, 503, { error: 'not connected' });

            const cacheKey = `wa:avatar:${jid}`;

            try {
                const cached = await redis.get(cacheKey);

                if (cached === AVATAR_NONE) return json(res, 404, { error: 'no avatar' });
                if (cached) return json(res, 200, { bucket: config.minio.bucket, key: cached, cached: true });

                // Timeout explícito: para alguns contatos o profilePictureUrl
                // pendura (sem resposta do servidor). Sem isso, o pedido ficava
                // preso por minutos e ainda cacheava "sem foto" indevidamente.
                // Muitos contatos individuais dão "Timed Out" aqui (o WhatsApp não
                // responde à consulta de foto pelo aparelho vinculado — limitação
                // conhecida). Timeout explícito evita pendurar; tratamos como
                // "sem foto" e cacheamos para não repetir a espera a cada abertura.
                let url;
                try {
                    url = await state.sock.profilePictureUrl(jid, 'image', config.avatar.timeoutMs);
                } catch (err) {
                    logger.warn({ jid, err: err?.message || String(err) }, 'profilePictureUrl timeout/erro; tratando como sem foto.');
                }

                if (!url) {
                    await redis.set(cacheKey, AVATAR_NONE, 'EX', config.avatar.negativeTtlSec);
                    return json(res, 404, { error: 'no avatar' });
                }

                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`fetch ${resp.status}`);

                const buffer   = Buffer.from(await resp.arrayBuffer());
                const mimetype = resp.headers.get('content-type') || 'image/jpeg';
                const key      = `${config.minio.prefix}/avatars/${jid.replace(/[^a-z0-9]/gi, '_')}.jpg`;

                await putBuffer(key, buffer, mimetype);
                await redis.set(cacheKey, key, 'EX', config.avatar.cacheTtlSec);

                return json(res, 200, { bucket: config.minio.bucket, key, mimetype, size: buffer.length });
            } catch (err) {
                logger.error({ err, jid }, 'Falha ao obter foto de perfil.');
                return json(res, 502, { error: 'avatar failed' });
            }
        }

        // Histórico sob demanda: pede ao WhatsApp mensagens mais antigas que a
        // `oldest` informada (scroll para cima). O resultado volta assíncrono no
        // evento messaging-history.set e é correlacionado pelo requestId.
        if (path === '/history/on-demand' && req.method === 'POST') {
            if (!state.connected || !state.sock) return json(res, 503, { error: 'not connected' });

            const body = await readJson(req);
            if (!body?.jid || !body?.oldest_id) return json(res, 400, { error: 'jid and oldest_id required' });

            try {
                const key   = { remoteJid: body.jid, id: body.oldest_id, fromMe: Boolean(body.oldest_from_me) };
                const count = Math.min(Math.max(Number(body.count) || 30, 1), 50);
                const ts    = Number(body.oldest_timestamp) || Math.floor(Date.now() / 1000); // unix segundos

                const requestId = await state.sock.fetchMessageHistory(count, key, ts);
                const messages  = await registerOnDemand(requestId, 20000);

                return json(res, 200, { messages });
            } catch (err) {
                logger.error({ err }, 'Falha no fetch de histórico sob demanda.');
                return json(res, 502, { error: 'on-demand failed' });
            }
        }

        if (path === '/check') {
            const number = new URL(req.url, 'http://x').searchParams.get('number');
            
            if (!number) return json(res, 400, { error: 'number required' });
            if (!state.connected || !state.sock) return json(res, 503, { error: 'not connected' });

            const jid = await resolveJid(state.sock, number);
            return json(res, 200, { input: number, exists: Boolean(jid), jid });
        }

        json(res, 404, { error: 'not found' });
    });

    server.listen(config.http.port, () => {
        logger.info(`HTTP de status em :${config.http.port} (/health /status /qr)`);
    });

    return server;
}