export const state = {
    startedAt: Date.now(),
    connected: false,
    jid: null,
    qr: null,
    lastDisconnect: null,
    reconnectAttempts: 0,
    blocked: false,        // circuit breaker: reconexão automática pausada
    blockedReason: null,
    sock: null,
    history: null,
};