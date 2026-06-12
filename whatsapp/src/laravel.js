import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

export async function postToLaravel(payload) {
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', config.webhookSecret).update(body).digest('hex');

    try {
        const res = await fetch(config.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-WA-Signature': `sha256=${signature}`,
            },
            body,
        });

        if (!res.ok) logger.error({ status: res.status, event: payload.event }, 'Webhook do Laravel retornou erro.');

        return res.ok;
    } catch (err) {
        logger.error({ err, event: payload.event }, 'Falha ao chamar o webhook do Laravel.');
        return false;
    }
}