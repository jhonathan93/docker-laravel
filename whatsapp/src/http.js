import http from 'node:http';
import QRCode from 'qrcode';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { logger } from './logger.js';
import { state } from './state.js';
import { resolveJid } from './numbers.js';
import { decodeMessage, detectMedia, extFor } from './parse.js';
import { putBuffer } from './media.js';

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
                const key      = `${config.minio.prefix}/ondemand/${id}.${extFor(mimetype)}`;

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