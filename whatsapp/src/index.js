import { logger } from './logger.js';
import { startHttpServer } from './http.js';
import { startWhatsApp } from './whatsapp.js';
import { forwardToLaravel } from './inbound.js';
import { forwardStatus } from './receipts.js';
import { forwardHistory } from './history.js';
import { startOutboundLoop } from './outbound.js';
import { ensureBucket } from './media.js';
import { state } from './state.js';

let sock = null;
const getSock = () => sock;

async function main() {
    logger.info('Iniciando WhatsApp gateway...');

    startHttpServer();

    await ensureBucket().catch((err) => logger.error({ err }, 'Falha ao garantir o bucket MinIO.'));
    
    await startWhatsApp({
        onMessage: forwardToLaravel,
        onStatus: forwardStatus,
        onHistory: forwardHistory,
        onSock: (s) => { sock = s; state.sock = s; },
    });

    startOutboundLoop(getSock);
}

main().catch((err) => {
    logger.error({ err }, 'Falha fatal ao iniciar o gateway.');
    process.exit(1);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
        logger.info(`Recebido ${sig}, encerrando.`);
        process.exit(0);
    });
}