#!/usr/bin/env bash
# Activa la aprobación por WhatsApp («APROBAR 12» / «RECHAZAR 12 motivo»).
# 1) Crea WHATSAPP_WEBHOOK_TOKEN en backend/.env si no existe (no se muestra).
# 2) Apunta el webhook de la instancia de Evolution (solo evento MESSAGES_UPSERT) a esta app.
# Uso (como root en el VPS): bash /var/www/mantenimiento/deploy/whatsapp-webhook.sh [https://dominio]
set -euo pipefail
APP=/var/www/mantenimiento
ENV="$APP/backend/.env"
DOMAIN="${1:-https://mantencion.ttslogistics.online}"

grep -q '^EVOLUTION_API_KEY=' "$ENV" || { echo "Faltan las variables EVOLUTION_* en $ENV" >&2; exit 1; }
if ! grep -q '^WHATSAPP_WEBHOOK_TOKEN=' "$ENV"; then
  echo "WHATSAPP_WEBHOOK_TOKEN=$(openssl rand -hex 24)" >> "$ENV"
  echo "Clave del webhook creada."
fi
systemctl restart mantenimiento
sleep 3
systemctl is-active --quiet mantenimiento && echo "Servicio reiniciado."

cd "$APP/backend"
sudo -u mantenimiento DOMAIN="$DOMAIN" node -e '
require("dotenv").config({ quiet: true });
const { loadConfig } = require("./src/config");
const c = loadConfig(), e = c.evolution, base = e.url.replace(/\/$/, ""), headers = { apikey: e.key, "Content-Type": "application/json" };
const url = `${process.env.DOMAIN}/api/whatsapp/webhook/${c.whatsappWebhookToken}`;
(async () => {
  const set = await fetch(`${base}/webhook/set/${encodeURIComponent(e.instance)}`, { method: "POST", headers,
    body: JSON.stringify({ webhook: { enabled: true, url, webhookByEvents: false, webhookBase64: false, events: ["MESSAGES_UPSERT"] } }) });
  if (!set.ok) throw new Error(`Evolution respondió ${set.status}`);
  const w = await (await fetch(`${base}/webhook/find/${encodeURIComponent(e.instance)}`, { headers })).json();
  console.log(w.enabled && String(w.url).startsWith(`${process.env.DOMAIN}/api/whatsapp/webhook/`)
    ? "Listo: el jefe ya puede aprobar respondiendo APROBAR <número> o RECHAZAR <número> <motivo>."
    : "Revisar: el webhook no quedó apuntando a mantención.");
})().catch(err => { console.error("Error:", err.message); process.exit(1); });
'
