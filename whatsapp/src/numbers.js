import { redis } from './redis.js';
import { config } from './config.js';
import { logger } from './logger.js';

const NONE = '__none__';

const digitsOf = (input) => String(input || '').replace(/\D/g, '');
const isGroup = (input) => String(input || '').endsWith('@g.us');

/**
 * Resolve o JID canônico de um número via `onWhatsApp`, com cache no Redis.
 *
 * - Existe → devolve o JID REAL registrado (resolve o 9º dígito brasileiro).
 * - Não existe → devolve `null` (cacheado por menos tempo, pode registrar depois).
 * - Erro na consulta → fail-open: devolve o JID montado do número (não bloqueia o envio).
 *
 * @returns {Promise<string|null>}
 */
export async function resolveJid(sock, input) {
    if (isGroup(input)) return input;

    const number = digitsOf(input);

    if (!number) return null;

    const cacheKey = `wa:jid:${number}`;
    const cached = await redis.get(cacheKey).catch(() => null);

    if (cached === NONE) return null;
    if (cached) return cached;

    try {
        const [result] = await sock.onWhatsApp(number);

        if (result?.exists && result.jid) {
            await redis.set(cacheKey, result.jid, 'EX', config.lookup.cacheTtlSec);
            return result.jid;
        }

        await redis.set(cacheKey, NONE, 'EX', config.lookup.negativeTtlSec);
        return null;
    } catch (err) {
        logger.warn({ err, number }, 'Falha ao consultar onWhatsApp; usando JID montado (fail-open).');
        return `${number}@s.whatsapp.net`;
    }
}