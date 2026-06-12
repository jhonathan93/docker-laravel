import http from 'node:http';
import QRCode from 'qrcode';
import { config } from './config.js';
import { logger } from './logger.js';
import { state } from './state.js';
import { resolveJid } from './numbers.js';

function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
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
                last_disconnect: state.lastDisconnect,
                reconnect_attempts: state.reconnectAttempts,
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