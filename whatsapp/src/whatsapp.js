import makeWASocket, {useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config } from './config.js';
import { logger } from './logger.js';
import { state } from './state.js';

const baileysLogger = pino({ level: 'warn' });

/**
 * Inicia (e mantém) a conexão com o WhatsApp.
 * @param {object} handlers
 * @param {(msg: object) => Promise<void>} handlers.onMessage   mensagem recebida
 * @param {(update: object) => Promise<void>} handlers.onStatus recibo de entrega/leitura
 * @param {(sock: object) => void} handlers.onSock              socket atual (reatribuído em reconexões)
 */
export async function startWhatsApp(handlers) {
    const { onMessage, onStatus, onSock } = handlers;
    const { state: authState, saveCreds } = await useMultiFileAuthState(config.authDir);

    let version;

    try {
        ({ version } = await fetchLatestBaileysVersion());
    } catch {
        logger.warn('Não foi possível obter a versão do WhatsApp; usando a padrão do Baileys.');
    }

    const sock = makeWASocket({
        ...(version ? { version } : {}), auth: authState, logger: baileysLogger,
    });

    onSock(sock);
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            state.qr = qr;
            logger.info('QR atualizado — veja em /qr (navegador) ou escaneie abaixo:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            state.connected = true;
            state.qr = null;
            state.jid = sock.user?.id || null;
            state.reconnectAttempts = 0;
            logger.info({ jid: state.jid }, '✅ WhatsApp conectado.');
        }

        if (connection === 'close') {
            state.connected = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            state.lastDisconnect = { code, at: Date.now() };
            scheduleReconnect(code, handlers);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe || !msg.message) continue;
            try {
                await onMessage(msg, sock);
            } catch (err) {
                logger.error({ err }, 'Falha ao processar mensagem recebida.');
            }
        }
    });

    sock.ev.on('messages.update', async (updates) => {
        for (const u of updates) {
            try {
                await onStatus(u);
            } catch (err) {
                logger.error({ err }, 'Falha ao processar recibo de status.');
            }
        }
    });
}

function scheduleReconnect(code, handlers) {
    if (code === DisconnectReason.loggedOut) {
        logger.error('Sessão encerrada (logout). Apague a pasta auth/ e reescaneie o QR.');
        return;
    }

    if (code === DisconnectReason.connectionReplaced) {
        logger.error('Conexão substituída por outra sessão do mesmo número. Não reconectando (evita loop).');
        return;
    }

    if (code === DisconnectReason.restartRequired) {
        logger.info('Restart requerido pelo WhatsApp; reconectando imediatamente.');
        startWhatsApp(handlers);
        return;
    }

    state.reconnectAttempts += 1;

    const delay = Math.min(
        config.reconnect.baseMs * 2 ** (state.reconnectAttempts - 1),
        config.reconnect.maxMs,
    );

    logger.warn({ code, attempt: state.reconnectAttempts, delay }, 'Conexão caiu; reconectando...');
    setTimeout(() => startWhatsApp(handlers), delay);
}