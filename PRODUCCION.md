# Despliegue seguro en un VPS

Configuracion objetivo: Ubuntu 24.04 LTS, Node.js 22, MySQL 8, Nginx y un dominio con HTTPS. Sustituye `mantenimiento.example.com` por el dominio real.

## 1. Requisitos

- DNS `A`/`AAAA` apuntando al VPS.
- Puertos publicos 80 y 443; SSH restringido si es posible.
- Los puertos 3306 y 5000 no deben exponerse a Internet.
- Node.js 22 (`node --version`) y MySQL 8.
- Codigo instalado en `/var/www/mantenimiento`.

Instala los paquetes del sistema:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y nginx mysql-server git curl ufw certbot python3-certbot-nginx
sudo apt install -y unattended-upgrades
```

## 2. Usuario del servicio y codigo

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin mantenimiento
sudo install -d -o mantenimiento -g mantenimiento -m 0750 /var/www/mantenimiento
sudo -u mantenimiento git clone URL_PRIVADA_DEL_REPOSITORIO /var/www/mantenimiento
sudo install -d -o mantenimiento -g mantenimiento -m 0750 /var/www/mantenimiento/backend/uploads
```

No subas `.env`, `node_modules`, `frontend/dist`, respaldos SQL ni claves al repositorio. Si migras una instalacion existente, importa su base completa y copia `backend/uploads` conservando los nombres.

## 3. Base de datos

```bash
sudo mysql
```

```sql
CREATE DATABASE mantenimiento CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mantenimiento_app'@'127.0.0.1' IDENTIFIED BY 'CLAVE-ALEATORIA-DE-32-O-MAS-CARACTERES';
GRANT ALL PRIVILEGES ON mantenimiento.* TO 'mantenimiento_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

El permiso amplio se necesita para ejecutar migraciones. Al terminar, puede reducirse a `SELECT, INSERT, UPDATE, DELETE`; antes de una futura migracion deberan restituirse temporalmente los permisos DDL.

## 4. Secretos y variables

Copia `deploy/production.env.example` a `backend/.env` y completa los valores:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=mantenimiento_app
DB_PASSWORD=CLAVE-ALEATORIA-DE-32-O-MAS-CARACTERES
DB_NAME=mantenimiento
CORS_ORIGINS=https://mantenimiento.example.com
SESSION_HOURS=8
MAX_UPLOAD_MB=10
IMAGE_MAX_DIMENSION=2560
IMAGE_WEBP_QUALITY=82
IMAGE_MAX_MEGAPIXELS=40
API_RATE_LIMIT=600
EDGE_RATE_LIMIT=1200
UPLOAD_RATE_LIMIT=30
UPLOAD_CONCURRENCY=2
LOGIN_RATE_LIMIT=10
LOGIN_IP_RATE_LIMIT=50
TRUST_PROXY_HOPS=1
ALLOW_MULTIPLE_DAILY_INSPECTIONS=false
GEMINI_API_KEY=CLAVE_DE_GEMINI
```

```bash
sudo chown mantenimiento:mantenimiento /var/www/mantenimiento/backend/.env
sudo chmod 600 /var/www/mantenimiento/backend/.env
```

En produccion el backend rechaza un origen que no sea HTTPS, una clave MySQL menor de 16 bytes o un `HOST` publico.

Las tres variables `IMAGE_*` controlan la optimizacion. Toda imagen de evidencia, factura o inspeccion se auto-orienta, reduce como maximo a 2560 x 2560, convierte a WebP con calidad 82 y guarda sin metadatos. `IMAGE_MAX_MEGAPIXELS` rechaza imagenes descomprimidas anormalmente grandes. Los PDF no se modifican.

## 5. Primera instalacion

```bash
cd /var/www/mantenimiento/backend
sudo -u mantenimiento npm ci
sudo -u mantenimiento npm run check
sudo -u mantenimiento npm test
sudo -u mantenimiento npm run migrate
```

En una base nueva crea el primer administrador sin guardar la clave en archivos ni en el historial:

```bash
cd /var/www/mantenimiento/backend
read -rp 'Nombre: ' ADMIN_NAME
read -rp 'Email: ' ADMIN_EMAIL
read -srp 'Contrasena (minimo 12 caracteres): ' ADMIN_PASSWORD; echo
export ADMIN_NAME ADMIN_EMAIL ADMIN_PASSWORD
sudo --preserve-env=ADMIN_NAME,ADMIN_EMAIL,ADMIN_PASSWORD -u mantenimiento npm run create-admin
unset ADMIN_NAME ADMIN_EMAIL ADMIN_PASSWORD
```

Compila el frontend con API del mismo origen:

```bash
cd /var/www/mantenimiento/frontend
sudo -u mantenimiento npm ci
sudo -u mantenimiento npm run lint
sudo -u mantenimiento npm run build
```

## 6. systemd y Nginx

Comprueba `which node`. Si no devuelve `/usr/bin/node`, ajusta `ExecStart` en el archivo de servicio.

```bash
sudo cp /var/www/mantenimiento/deploy/mantenimiento.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mantenimiento
sudo systemctl status mantenimiento
curl --fail http://127.0.0.1:5000/api/health
```

Instala la plantilla Nginx reemplazando el dominio:

```bash
sudo sed 's/__DOMAIN__/mantenimiento.example.com/g' /var/www/mantenimiento/deploy/nginx.conf | sudo tee /etc/nginx/sites-available/mantenimiento >/dev/null
sudo ln -s /etc/nginx/sites-available/mantenimiento /etc/nginx/sites-enabled/mantenimiento
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Elimina `rm -f` de este procedimiento si el sitio predeterminado tiene contenido que debas conservar.

## 7. Firewall y TLS

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo certbot --nginx -d mantenimiento.example.com
sudo certbot renew --dry-run
```

Comprueba `https://mantenimiento.example.com/api/health`, el acceso, los cuatro roles, una carga de imagen, una factura y la descarga Excel.

Comprueba también la instalación PWA: en Android usa la sugerencia `Instalar aplicacion`; en iPhone o iPad abre el sitio con Safari y elige Compartir → Agregar a inicio. La PWA necesita HTTPS. La interfaz básica puede abrir desde caché, pero las sesiones, datos, API y archivos privados siguen requiriendo conexión al servidor.

## 8. Actualizaciones

Haz primero un respaldo externo. Luego actualiza el codigo y ejecuta:

```bash
sudo bash /var/www/mantenimiento/deploy/release.sh
sudo journalctl -u mantenimiento -n 100 --no-pager
```

## 9. Respaldos

Crea `/etc/mantenimiento/mysql-backup.cnf`, propiedad de `root` y modo `600`:

```ini
[client]
host=127.0.0.1
user=mantenimiento_backup
password=CLAVE_EXCLUSIVA_DE_RESPALDO
```

El usuario de respaldo necesita permisos de solo lectura:

```sql
CREATE USER 'mantenimiento_backup'@'127.0.0.1' IDENTIFIED BY 'OTRA-CLAVE-ALEATORIA-LARGA';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON mantenimiento.* TO 'mantenimiento_backup'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Luego ejecuta:

```bash
sudo bash /var/www/mantenimiento/deploy/backup.sh
```

Cada respaldo contiene base, archivos y sumas SHA-256. Copialo fuera del VPS y prueba periodicamente una restauracion. No programes el cron hasta comprobar manualmente el script y el almacenamiento externo.

## 10. Diagnostico

```bash
sudo systemctl status mantenimiento nginx mysql
sudo journalctl -u mantenimiento -f
sudo tail -f /var/log/nginx/error.log
curl -i http://127.0.0.1:5000/api/health
```

Nunca publiques el contenido de `backend/.env`, las cookies de sesion, el respaldo SQL o la clave de Gemini al pedir soporte.

## 11. Privacidad y mantenimiento

Las fotografias de inspecciones y los documentos de cobro se envian a la API de Gemini para su analisis. Confirma que ese tratamiento sea compatible con las politicas de la empresa y evita cargar datos personales que no sean necesarios.

Mantiene Ubuntu, Node.js y las dependencias al dia. Antes de cada actualizacion ejecuta `npm audit`, las pruebas y un respaldo restaurable. Revisa periodicamente usuarios administradores, sesiones, espacio libre, logs de Nginx y crecimiento de `backend/uploads`.

## 12. Compras, inventario y kilometraje

- El jefe recibe las cotizaciones como aviso en la app y por WhatsApp: al pulsar «Enviar cotización» se abre WhatsApp con el mensaje listo para el número del jefe. Registra ese número en Usuarios (campo WhatsApp, con código de país, por ejemplo `56912345678`).
- Videos del antes/después: `MAX_VIDEO_MB` (por defecto 100). Nginx ya permite cuerpos de hasta 110 MB.
- Kilometraje desde TTS (opcional): crea en PostgreSQL un usuario con permiso solo de lectura sobre la tabla `"EjecucionRuta"` y define en `backend/.env`:

```env
TTS_DATABASE_URL=postgresql://mantencion_lectura:CLAVE@127.0.0.1:5432/BASE_TTS
TTS_SYNC_MINUTES=60
```

Sin esta variable, el kilometraje de cada camión se ingresa a mano en «Mantención por km».

## 13. WhatsApp automático (Evolution API)

Con estas variables en `backend/.env` cada aviso de la app también sale por WhatsApp a los usuarios que tengan número
(Usuarios → WhatsApp), con el enlace directo a la OT y las fotos (evidencia del mecánico, comprobante, lo comprado):

```
EVOLUTION_API_URL=http://127.0.0.1:8080
EVOLUTION_INSTANCE=<instancia>
EVOLUTION_API_KEY=<clave>
```

Sin ellas, la app sigue abriendo WhatsApp a mano en «Enviar cotización» y «Registrar compra».

**Aprobar respondiendo.** Con `WHATSAPP_WEBHOOK_TOKEN` (clave larga) el mensaje de cotización indica
«Para aprobar responde: APROBAR 12 / RECHAZAR 12 motivo». Solo se aceptan respuestas desde números de jefes o
administradores registrados; el resto de los mensajes se ignora. Hay que apuntar el webhook de la instancia (evento
`MESSAGES_UPSERT`) a `https://<dominio>/api/whatsapp/webhook/<WHATSAPP_WEBHOOK_TOKEN>`. Una instancia de Evolution tiene
un solo webhook: si otro sistema ya lo usa, se debe reenviar desde ahí o usar una instancia propia.
