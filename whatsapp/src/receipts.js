import { postToLaravel } from './laravel.js';

const STATUS = {
    0: 'error',
    1: 'pending',
    2: 'sent',
    3: 'delivered',
    4: 'read',
    5: 'played',
};


export async function forwardStatus(update) {
    const status = update.update?.status;
    if (status === undefined || status === null) return;
    if (!update.key?.fromMe) return;

    await postToLaravel({
        event: 'status',
        wa_message_id: update.key.id,
        to: update.key.remoteJid,
        status: STATUS[status] ?? String(status),
    });
}