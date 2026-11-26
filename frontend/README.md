# Mantenimiento · Travel Trans

Interfaz React y Tailwind para camiones, usuarios, tareas, evidencias, gastos y reportes. Conserva el logo oficial y la identidad roja, negra y blanca; los colores adicionales indican estados operativos.

Las imágenes de evidencias, documentos e inspecciones se optimizan en el backend antes de guardarse: se corrige la orientación, se eliminan metadatos, se limita la resolución y se convierten a WebP. Los PDF se conservan sin cambios.

La interfaz también es una PWA instalable. El build genera el manifiesto y el service worker, precarga solamente la interfaz estática y fuerza acceso de red para `/api` y `/uploads`, evitando almacenar datos privados en la caché offline. Android muestra la acción de instalación cuando el navegador la habilita; en iPhone y iPad se instala desde Compartir → Agregar a inicio.

## Desarrollo y compilación

Desde `frontend`: `npm.cmd install`, `npm.cmd run dev`. Vite redirige `/api` y `/uploads` al backend local en el puerto 5000. MySQL conserva la configuración de `backend/.env`. El acceso utiliza `POST /api/login`.

Validar con `npm.cmd run lint` y `npm.cmd run build`; la compilación queda en `dist`. Si se cambia `pwa-source.png`, regenerar los iconos con `npm.cmd run pwa:assets` antes de compilar.

Para desplegar, servir `dist` y configurar un proxy inverso para `/api` y `/uploads`. Si el backend está en otro origen, definir `VITE_API_URL` antes de compilar con su origen público, sin `/api` al final. Ver `.env.example`. Las variables `VITE_*` son públicas y no deben contener secretos.

## Archivos principales

- `src/App.jsx`: acceso y cierre de sesión.
- `src/Dashboard.jsx`: navegación y paneles por rol.
- `src/components/UI.jsx`: campos, botones, tablas, estados y secciones.
- `src/components/RecordForm.jsx`: formularios compartidos.
- `src/components/TaskDetail.jsx`: evidencias, gastos y aprobación.
- `src/components/Modal.jsx`: diálogo nativo, Escape, foco y bloqueo de scroll.
- `src/index.css`: estilos y adaptaciones responsive.
- `src/api.js`: cliente HTTP y validación de respuestas.

## Pruebas de interfaz

Desde la raíz, `qa/interface.cjs` comprueba cuatro roles a 320, 390, 768, 1024 y 1440 píxeles. Las respuestas controladas existen únicamente en las pruebas: no se modifican registros reales. Incluye acceso, carga, reintento, CRUD, filtros, archivos, gastos, estados, exportación, foco, menú y desbordamientos. Guarda capturas en `qa/screenshots`.

Con Vite iniciado y Playwright/Chromium disponibles:

```powershell
$env:PLAYWRIGHT_MODULE = 'ruta/al/modulo/playwright'
$env:CHROME_PATH = 'ruta/al/navegador/chrome.exe'
node qa/interface.cjs
```

Las variables son opcionales si Playwright y su navegador están instalados en las ubicaciones predeterminadas. `TEST_URL` permite comprobar otro servidor local.

Resultado: 93 comprobaciones aprobadas, lint y build correctos. Se verificaron también consultas reales y renderizado de los cuatro paneles contra el backend local, sin escrituras.

## Alcance de producción

El backend usa contraseñas protegidas con `scrypt`, sesiones opacas almacenadas como hash, permisos por rol, protección CSRF/CORS, límites de solicitudes y validación de archivos. La configuración del VPS, HTTPS, secretos, respaldos y actualizaciones está documentada en `../PRODUCCION.md`. Las pruebas de integración cubren los flujos reales sobre un esquema MySQL temporal.
