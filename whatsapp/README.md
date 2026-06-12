# WhatsApp Gateway (Baileys)

Microserviço Node que mantém a conexão com o WhatsApp e faz a ponte com o Laravel.

- **Entrada** (WhatsApp → Laravel): a cada mensagem, faz `POST` assinado (HMAC) em `LARAVEL_WEBHOOK_URL`.
- **Saída** (Laravel → WhatsApp): consome a fila Redis `wa:outbound` (`BLPOP`) e envia.
- **Sessão**: persistida em `auth/` (volume) — escaneia o QR uma vez só.

> ⚠️ Baileys é não-oficial (engenharia reversa do WhatsApp Web). Risco de ban do número. Para produção séria, avaliar a WhatsApp Business Cloud API (Meta).

## Subir

```bash
docker compose up -d whatsapp
docker compose logs -f whatsapp     # mostra o QR code no primeiro start
```

Escaneie o QR em: WhatsApp > **Aparelhos conectados** > **Conectar aparelho**.

## Reparear do zero

```bash
docker compose stop whatsapp
rm -rf whatsapp/auth/*
docker compose up -d whatsapp && docker compose logs -f whatsapp
```

## Enviar uma mensagem de teste (pela fila Redis)

```bash
docker compose exec redis redis-cli RPUSH wa:outbound \
  '{"jid":"5511999999999@s.whatsapp.net","text":"Olá do gateway!"}'
```

## Variáveis (ver `.env.example`)

| Var | Default | Descrição |
|-----|---------|-----------|
| `REDIS_HOST` / `REDIS_PORT` | `redis` / `6379` | Redis |
| `LARAVEL_WEBHOOK_URL` | `http://app/api/whatsapp/webhook` | webhook de entrada |
| `WEBHOOK_SECRET` | — | segredo do HMAC (defina em `WHATSAPP_WEBHOOK_SECRET` no `.env` da raiz) |
| `WA_OUTBOUND_KEY` | `wa:outbound` | fila de saída |
| `AUTH_DIR` | `/app/auth` | pasta da sessão |
