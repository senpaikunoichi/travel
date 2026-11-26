# Manual: levantar el sistema en local

Guia para trabajar en la rama `implementacion-funcionalidades` con el backend (Node.js + Express + MySQL) y el frontend (React + Vite) en tu computador. Para el servidor de produccion revisa `PRODUCCION.md`; la estructura del sistema esta en `docs/estructura-sistema.pdf`.

## 1. Requisitos

| Programa | Version | Comprobar |
|----------|---------|-----------|
| Git | cualquiera reciente | `git --version` |
| Node.js | 22 o superior | `node --version` |
| MySQL | 8 | `mysql --version` |

Instalacion rapida:

- **macOS** (Homebrew): `brew install node@22 mysql git` y luego `brew services start mysql`.
- **Windows**: instala Node.js 22 LTS desde nodejs.org, MySQL 8 con *MySQL Installer* (incluye MySQL Workbench) y Git for Windows.
- **Linux (Ubuntu)**: `sudo apt install -y mysql-server git` y Node.js 22 desde NodeSource o `nvm`.

## 2. Obtener el codigo

```bash
git clone URL_DEL_REPOSITORIO Mantencion
cd Mantencion
git checkout implementacion-funcionalidades
```

Trabaja siempre en esta rama (o en ramas que salgan de ella). No hagas commits directos en `main`.

## 3. Crear la base de datos

Entra a MySQL como administrador (`mysql -u root -p`, o `sudo mysql` en Linux) y ejecuta:

```sql
CREATE DATABASE mantenimiento CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mantenimiento'@'localhost' IDENTIFIED BY 'clave_local_dev';
GRANT ALL PRIVILEGES ON mantenimiento.* TO 'mantenimiento'@'localhost';
FLUSH PRIVILEGES;
```

Las tablas no se crean a mano: las crea el script de migracion del paso 5.

## 4. Configurar el backend

```bash
cd backend
cp .env.example .env        # Windows: copy .env.example .env
```

Edita `backend/.env` y completa como minimo:

```env
DB_USER=mantenimiento
DB_PASSWORD=clave_local_dev
DB_NAME=mantenimiento
GEMINI_API_KEY=            # opcional, ver nota
```

El resto de valores de `.env.example` ya sirven para desarrollo (`NODE_ENV=development`, puerto 5000, CORS para `localhost:5173`).

> **GEMINI_API_KEY**: solo se usa para analizar fotos de inspecciones y leer facturas con IA. Sin clave el sistema funciona, pero esas dos funciones fallaran. Pide una clave de pruebas al responsable del proyecto; nunca la subas al repositorio.

`backend/.env` esta en `.gitignore`. No lo compartas ni lo subas.

## 5. Instalar dependencias, migrar y crear el administrador

Desde `backend/`:

```bash
npm ci
npm run migrate
```

`npm run migrate` crea o actualiza todas las tablas. Es seguro ejecutarlo varias veces.

Crea el primer usuario administrador (la contrasena debe tener al menos 12 caracteres):

macOS / Linux:

```bash
ADMIN_NAME="Admin Local" ADMIN_EMAIL="admin@local.test" ADMIN_PASSWORD="ClaveLocal1234" npm run create-admin
```

Windows (PowerShell):

```powershell
$env:ADMIN_NAME="Admin Local"; $env:ADMIN_EMAIL="admin@local.test"; $env:ADMIN_PASSWORD="ClaveLocal1234"; npm run create-admin
```

Con ese administrador podras crear camiones y usuarios de los otros roles (`jefe`, `encargado`, `mecanico`) desde la aplicacion.

## 6. Levantar el backend

```bash
npm run dev
```

`npm run dev` reinicia el servidor al guardar cambios. Debe aparecer `Backend disponible en http://127.0.0.1:5000`. Compruebalo en otra terminal:

```bash
curl http://127.0.0.1:5000/api/health
# {"success":true,"status":"ok"}
```

Deja esta terminal abierta.

## 7. Levantar el frontend

En una **segunda terminal**:

```bash
cd frontend
npm ci
npm run dev
```

Abre <http://localhost:5173> e inicia sesion con el administrador del paso 5.

No necesitas crear `frontend/.env`: en desarrollo Vite reenvia `/api` y `/uploads` al backend en el puerto 5000 (ver `frontend/vite.config.js`).

## 8. Verificaciones antes de subir cambios

Backend (`backend/`):

```bash
npm run check      # revisa la sintaxis de todos los .js
npm test           # pruebas unitarias
RUN_DB_TESTS=1 npm test   # incluye pruebas de integracion contra MySQL (crea y borra esquemas temporales)
```

Frontend (`frontend/`):

```bash
npm run lint
npm run build
```

Si todo pasa, haz commit en tu rama y abre un Pull Request hacia `implementacion-funcionalidades`.

## 9. Uso diario

1. `git pull` en la rama.
2. Si cambiaron `package.json` o las migraciones: `npm ci` y `npm run migrate` en `backend/`, `npm ci` en `frontend/`.
3. Terminal 1: `cd backend && npm run dev`.
4. Terminal 2: `cd frontend && npm run dev`.

Para detener cualquiera de los dos: `Ctrl + C`.

## 10. Problemas frecuentes

| Mensaje | Causa y solucion |
|---------|------------------|
| `Faltan DB_HOST, DB_USER o DB_NAME` | No existe `backend/.env` o le faltan esos valores. Revisa el paso 4. |
| `ER_ACCESS_DENIED_ERROR` | Usuario o clave de MySQL incorrectos en `.env`. |
| `ECONNREFUSED` (puerto 3306) | MySQL no esta encendido. macOS: `brew services start mysql`; Windows: inicia el servicio MySQL80. |
| `ER_BAD_DB_ERROR` | La base `mantenimiento` no existe. Repite el paso 3. |
| `Ejecuta npm run migrate antes de iniciar el backend` | Faltan tablas o hay contrasenas sin proteger. Ejecuta `npm run migrate`. |
| `EADDRINUSE` | El puerto 5000 o 5173 ya esta ocupado. Cierra el otro proceso o cambia `PORT` en `.env` (y el proxy en `vite.config.js`). |
| `Origen no permitido` | Estas abriendo el frontend desde una URL que no esta en `CORS_ORIGINS`. Usa `http://localhost:5173`. |
| En macOS, el puerto 5000 lo usa *Receptor AirPlay* | Desactivalo en Ajustes del Sistema → General → AirDrop y Handoff, o cambia el puerto. |
| Errores al instalar `sharp` | Verifica Node 22 y borra `backend/node_modules` antes de repetir `npm ci`. |
| La IA no responde en inspecciones o facturas | Falta o es invalida `GEMINI_API_KEY`. |
