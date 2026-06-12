export const state = {
    startedAt: Date.now(),
    connected: false,
    jid: null,
    qr: null,
    lastDisconnect: null,
    reconnectAttempts: 0,
    sock: null,
};