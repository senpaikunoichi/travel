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

> **GEMINI_API_KEY**: se usa para analizar fotos de inspecciones, leer facturas y autocompletar repuestos desde fotos. Sin clave el resto del sistema funciona, pero estas funciones de IA no estarán disponibles. Pide una clave de pruebas al responsable del proyecto; nunca la subas al repositorio.

`backend/.env` esta en `.gitignore`. No lo compartas ni lo subas.

## 5. Instalar dependencias, migrar y crear el administrador

Desde `backend/`:

```bash
npm ci
npm run migrate
```

`npm run migrate` crea o actualiza todas las tablas. Es seguro ejecutarlo varias veces cuando ya tienen la estructura actual.
También crea las tablas de inventario: `repuestos`, `movimientos_inventario` y `solicitudes_compra`. Si detecta tablas de inventario de una versión de prueba con columnas incompatibles, las renombra como respaldo (`*_legacy_*`) antes de crear el esquema actual. Esto conserva las relaciones de claves foráneas y permite que tablas antiguas que las referencian sigan apuntando al respaldo.
Para comprobar que esas tres tablas existen y ver el número exacto de registros en la base `mantenimiento`, ejecuta `npm run check:inventory` desde `backend/` después de configurar `.env` y migrar.

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

### Inventario de taller

En escritorio, las secciones están agrupadas en la navegación superior. En móviles, usa la barra inferior **Inicio, Tareas, Flota, Bodega, Mecánicos y Más**; los accesos disponibles dependen del rol. **Inicio** es informativo y muestra indicadores de tareas, camiones, mecánicos, stock, compras e inspecciones. **Flota** reúne camiones activos, unidades en panne y el historial de inspecciones (el encargado también puede registrar una inspección). Desde **Ver detalle** en una tarjeta se abre la ficha del camión, con sus datos, historial de tareas y reparaciones, mecánicos, gastos, evidencias e inspecciones. **Bodega** agrupa el catálogo, las solicitudes de compra y los reportes de inventario.

En **Tareas** se asignan trabajos a camiones y mecánicos según los permisos del rol, y se consultan estados, fechas y detalles. **Mecánicos** permite consultar el total asignado, trabajos completados, carga pendiente, porcentaje de cumplimiento e historial individual. **Más** contiene únicamente **Editar perfil** (nombre y correo) y **Cerrar sesión**. En escritorio, la gestión de usuarios y reportes de mantenimiento permanecen en la navegación superior.

Los roles `admin`, `jefe` y `encargado` (supervisor del taller) pueden consultar el catálogo; solo `admin` y `encargado` pueden crear, editar o eliminar productos. El rol `mecanico` no tiene acceso al módulo. El botón **Capturar foto o subir imagen** abre la cámara/galería del teléfono o el explorador de archivos del computador. Al elegir la imagen, Gemini analiza automáticamente si es un repuesto o un documento, completa los campos para revisión y busca coincidencias por código o nombre en el catálogo. Si reconoce un producto existente, la confirmación suma stock al mismo repuesto; si no, crea el repuesto con su movimiento de entrada. En facturas con varios productos, revisa y corrige las líneas detectadas y luego confírmalas todas de una vez; el ingreso del documento es atómico. El formulario permite corregir los datos detectados y también existe la alternativa **Agregar manualmente**. El campo opcional **Costo unitario estimado** permite calcular el valor valorizado del stock; el reporte aclara cuántos productos no tienen costo registrado.

La API de inventario también admite estas rutas (todas requieren sesión; solo `admin`, `jefe` y `encargado` están autorizados):

| Método | Ruta | Uso |
|--------|------|-----|
| `GET` | `/api/inventario` | Listar repuestos con estado del stock. |
| `GET` | `/api/inventario/buscar?codigo=XXX` | Buscar un repuesto por código QR o de barras. |
| `POST` | `/api/inventario` | Crear un repuesto; acepta los campos del formulario y una foto opcional `foto`. |
| `POST` | `/api/inventario/movimiento` | Registrar una entrada o salida de stock asociada al usuario autenticado. |

Las rutas anteriores bajo `/api/inventario/repuestos` y `/api/inventario/movimientos` se mantienen disponibles.

Los roles `admin`, `jefe` y `encargado` también tienen acceso a **Bodega → Reportes de inventario**. Elige fechas, categoría, estado de stock, tipo de movimiento y camión; el período afecta el historial de movimientos, mientras que el stock refleja el estado actual. La vista previa muestra indicadores, el detalle de stock y los movimientos. Los botones descargan Excel (resumen, stock filtrable e historial) o PDF A4 apaisado. En **Bodega → Solicitudes de compra**, crea solicitudes de repuestos, adjunta fotos y revisa sus estados; `admin` y `jefe` pueden aprobarlas o marcarlas como recibidas. Al incorporar el campo de costo en una base existente, ejecuta `npm run migrate` en `backend/` antes de reiniciar el servidor.

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
