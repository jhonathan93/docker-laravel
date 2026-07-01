/* ══════════════════════════════════════════════════════════════
   On-demand history — correlaciona o fetchMessageHistory (requestId)
   com o evento messaging-history.set que chega depois, assíncrono.
   ══════════════════════════════════════════════════════════════ */

import { logger } from './logger.js';

const pending = new Map(); // requestId → { resolve, timer }

/**
 * Registra um pedido on-demand e devolve uma Promise que resolve com as
 * mensagens quando o resultado chegar (via resolveOnDemand), ou com [] se
 * estourar o timeout.
 */
export function registerOnDemand(requestId, timeoutMs = 20000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            if (pending.delete(requestId)) {
                logger.warn({ requestId }, 'Pedido on-demand expirou (sem resposta do WhatsApp).');
                resolve([]);
            }
        }, timeoutMs);

        pending.set(requestId, { resolve, timer });
    });
}

/** Entrega o resultado a um pedido pendente. Retorna true se havia pedido. */
export function resolveOnDemand(requestId, messages) {
    const entry = pending.get(requestId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve(messages);
    return true;
}

/** Há um pedido pendente para esse requestId? */
export function isOnDemand(requestId) {
    return Boolean(requestId) && pending.has(requestId);
}
