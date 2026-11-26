
# Sistema de diseño Travel Trans Logística

Esta guía define la base visual de todos los sistemas de Travel Trans Logística.

**Al empezar un proyecto:** crea `design.md` en la raíz con esta guía y completa los datos del proyecto. Si el proyecto no tiene la carpeta `assets` con los logos, pídesela a la persona; nunca redibujes el logo.

**Dirección visual:** una sala blanca y amplia. Titulares grandes y firmes flotan en mucho espacio vacío. La interfaz es casi monocroma (tinta sobre blanco y gris muy claro) y el rojo de la marca es el único color de acción.

**Regla principal:** usa siempre los tokens de este documento. No agregues colores, fuentes, tamaños ni sombras fuera de esta guía sin documentar antes el cambio.

> Cambio del 02-11-2026: la guía pasó del tema oscuro ("ruta de noche") al tema claro. Los proyectos que ya tienen su `design.md` oscuro lo mantienen hasta que se rediseñen.

---

## 1. Datos del proyecto

| Campo | Valor |
|---|---|
| Empresa | Travel Trans Logística |
| Nombre del sistema | Mantenimiento de flota |
| Tipo | Panel web + PWA instalable |
| Público | Administradores, encargados, jefes y mecánicos |
| Protagonista visual | Datos de operación (tareas y estado de la flota) |
| Dato principal | Tareas por estado y camiones activos / en panne |
| Idioma principal | Español |
| Temas | Claro y oscuro. Sigue el del dispositivo (`frontend/public/theme.js`); selector Sistema / Claro / Oscuro en la barra (en móvil, dentro del menú) y en el inicio de sesión. Tokens oscuros en `:root[data-theme=dark]` de `frontend/src/index.css`. |
| Excepciones a esta guía | Panel de datos: separación entre secciones de 28 px. Logos en `frontend/public/assets`. Estados con punto de color + texto (verde/naranjo/rojo de los tokens funcionales). Dona de flota en `success`/`error`. |

---

## 2. Principios

1. **El espacio blanco es el escenario.** Cada palabra tiene aire alrededor; ante la duda, usa más espacio.
2. **La tipografía manda.** La jerarquía nace del tamaño y el peso de los titulares, no de cajas, bordes ni colores.
3. **La interfaz es monocroma.** El color viene de las fotos de la operación y de los datos, nunca de la decoración.
4. **Un solo color de acción.** El rojo de la marca marca lo que se puede hacer; nada más compite con él.
5. **Elegante y accesible.** Ninguna decisión estética justifica perder legibilidad.

---

## 3. Marca y logo

**Todos los sistemas llevan el logo de Travel Trans Logística.** Debe aparecer en la navegación, el inicio de sesión, el pie de página y los documentos o correos que genere el sistema. El favicon usa el icono.

| Archivo | Usar en |
|---|---|
| `assets/logo-travel-trans.png` | Fondos claros, desde 40 px de alto (el caso normal) |
| `assets/logo-travel-trans-oscuro.png` | Fondos oscuros (fotos o bandas oscuras), desde 40 px de alto |
| `assets/logo-travel-trans-compacto.png` | Navegación y espacios de 24 a 39 px de alto, en cualquier fondo |
| `assets/icono-travel-trans.png` | Favicon, icono de app y espacios cuadrados |

**Reglas**

- Por debajo de 40 px usa la versión compacta: "LOGÍSTICA" deja de leerse.
- Por debajo de 24 px de alto usa solo el icono.
- Deja alrededor del logo un espacio libre de al menos una cuarta parte de su altura.
- Enlázalo al inicio del sistema y usa `alt="Travel Trans Logística"`.
- No lo redibujes, recolorees, deformes, rotes, ni le agregues sombras o efectos.
- No lo pongas sobre fotografías recargadas ni sobre rojo.
- No imites el logotipo con texto: en la interfaz el nombre se escribe en Inter.

---

## 4. Colores

El tema es **claro**. Las secciones alternan blanco y gris muy claro; ese cambio de fondo separa el contenido, sin líneas divisorias.

Usa los tokens por su función: en el código se escribe `var(--color-primary)`, no `#E00000`.

### Superficies

| Nivel | Token | Valor | Uso |
|---|---|---|---|
| 0 | `--surface-paper` | `#FFFFFF` | Fondo principal y tarjetas |
| 1 | `--surface-canvas` | `#F5F5F7` | Bandas alternas, pie de página y tarjetas sobre blanco |
| 2 | `--surface-wash` | `#E8E8ED` | Hover de controles claros, botones suaves y puntos inactivos |
| 3 | `--surface-nav` | `#FAFAFC` | Navegación al hacer scroll (con desenfoque) y paneles elevados |
| — | `--surface-dark` | `#1D1D1F` | Solo para bandas o tarjetas oscuras puntuales (fotos, video) |

### Texto y bordes

| Token | Valor | Uso |
|---|---|---|
| `--color-text` | `#1D1D1F` | Texto principal, titulares y etiquetas de botones secundarios |
| `--color-text-muted` | `#707070` | Texto secundario, etiquetas y navegación inactiva |
| `--color-text-nav` | `#474747` | Texto e iconos de navegación |
| `--color-hairline` | `#D6D6D6` | Bordes de campos y líneas finas; casi nunca entre secciones |
| `--color-glyph` | `#1D1D1F` | Iconos |

### Color funcional

| Token | Valor | Uso |
|---|---|---|
| `--color-brand` | `#FF0000` | Rojo del logo: logo y detalles de marca. Como texto, solo desde 24 px |
| `--color-primary` | `#E00000` | Relleno de botones de acción: el único color saturado de la interfaz |
| `--color-primary-hover` | `#B80000` | Hover de botones de acción |
| `--color-on-primary` | `#FFFFFF` | Texto sobre `primary` |
| `--color-link` | `#1D1D1F` | Enlaces de texto, subrayados, con flecha `›` cuando llevan a otra vista |
| `--color-focus` | `#1D1D1F` | Anillo de foco |
| `--color-badge` | `#B64400` | Texto de insignias de novedad ("Nuevo"), sin fondo |
| `--color-success` | `#1A7F37` | Confirmaciones |
| `--color-warning` | `#B25000` | Advertencias |
| `--color-error` | `#D70015` | Errores |

**Reglas**

- `primary` es el único color saturado en controles. Úsalo como máximo una vez por sección.
- No hay acento azul: los enlaces van en `text`, subrayados.
- `brand` nunca lleva texto blanco pequeño encima: los botones usan `primary`.
- Alterna `paper` y `canvas` entre secciones para dar ritmo; no uses líneas divisorias.
- Las cifras y datos destacados van en `text`, grandes y en peso 600–700: el tamaño es el énfasis, no el color.
- La insignia `badge` aparece como mucho una vez por pantalla.
- No uses degradados en superficies de la interfaz: solo pueden vivir dentro de fotos o videos.
- No comuniques un estado solo con color: acompáñalo con un icono o texto.
- El rojo de error se parece al de marca: un error siempre lleva icono y texto.

---

## 5. Tipografía

| Rol | Fuente | Pesos |
|---|---|---|
| Titulares y cifras | Inter Display o Inter | 600 y 700 |
| Texto e interfaz | Inter | 400, 500 y 600 |

Pila de fuentes: `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif`. Así los dispositivos Apple muestran su fuente del sistema y el resto usa Inter. Activa `font-variant-numeric: tabular-nums` en cifras y tablas.

> **Licencia:** no alojes ni incluyas los archivos de SF Pro en el proyecto. Su licencia los limita a interfaces para plataformas de Apple. Inter es la alternativa libre.

| Estilo | Tamaño | Interlineado | Peso | Tracking | Uso |
|---|---|---|---|---|---|
| `display` | 96 px / 6rem | 1.04 | 700 | -1.44 px | Titular principal de una landing |
| `heading-lg` | 80 px / 5rem | 1.05 | 700 | -1.2 px | Titular de hero en vistas internas |
| `heading` | 56 px / 3.5rem | 1.07 | 600 | -0.28 px | Titulares de sección grandes y cifras principales |
| `heading-sm` | 40 px / 2.5rem | 1.2 | 600 | 0 | Título de tarjeta destacada |
| `subheading` | 32 px / 2rem | 1.13 | 600 | 0.128 px | Títulos de métricas |
| `section-heading` | 28 px / 1.75rem | 1.14 | 600 | 0.196 px | Título de sección (paneles y vistas de datos) |
| `body-lg` | 21 px / 1.3125rem | 1.38 | 400 | 0.231 px | Párrafo que acompaña a un titular |
| `body` | 17 px / 1.0625rem | 1.47 | 400 | -0.374 px | Texto general |
| `body-strong` | 17 px / 1.0625rem | 1.24 | 600 | -0.374 px | Texto destacado |
| `caption` | 14 px / 0.875rem | 1.29 | 400 o 600 | -0.224 px | Notas, precios y tablas densas |
| `micro` | 12 px / 0.75rem | 1.33 | 400 | -0.12 px | Navegación global y letra chica legal |

**Reglas**

- Los titulares grandes tienen tracking negativo e interlineado apretado (1.04–1.07); el texto corrido se abre a 1.47. Ese contraste crea la jerarquía.
- En móvil reduce `display` y `heading-lg` a 48 px, y `heading` a 40 px.
- Ningún título va por debajo de 600 de peso ni el texto por debajo de 400.
- Los titulares pueden ir centrados; los párrafos de varias líneas van siempre alineados a la izquierda.
- No uses `micro` para contenido: 12 px queda reservado a la navegación y a la letra chica.
- Mantén el texto largo entre 60 y 75 caracteres por línea.
- Usa un solo `h1` por página y no saltes niveles de título.

---

## 6. Espaciado

Unidad base de 4 px.

| Token | Valor | Uso típico |
|---|---|---|
| `--space-4` | 4 px | Separación mínima entre elementos |
| `--space-8` | 8 px | Elementos muy relacionados (8–10 px entre elementos) |
| `--space-12` | 12 px | Interior de controles |
| `--space-16` | 16 px | Margen lateral en móvil e interior mínimo de tarjetas |
| `--space-20` | 20 px | Separación entre tarjetas |
| `--space-28` | 28 px | Interior de tarjetas |
| `--space-40` | 40 px | Interior de tarjetas grandes |
| `--space-48` | 48 px | Título y contenido de sección |
| `--space-80` | 80 px | Separación entre secciones en móvil |
| `--space-120` | 120 px | Separación entre secciones en escritorio |

La densidad es cómoda. En paneles de datos se puede bajar la separación entre secciones a 48 px; regístralo como excepción del proyecto.

---

## 7. Layout

La página es una secuencia de bandas a todo el ancho que alternan `paper` y `canvas`:

1. Navegación global de 44 px, fija arriba, con el logo compacto.
2. Hero centrado sobre blanco: nombre pequeño (`body`), titular enorme, un botón primario y una nota breve; la imagen ocupa la parte baja.
3. Secciones con título alineado a la izquierda y, debajo, una distribución de 2 columnas (texto e imagen), una grilla de 3 tarjetas o una pieza visual centrada.
4. Bloques de detalle con el texto en una columna angosta (unos 560 px) junto a una imagen más ancha.
5. Pie de página sobre `canvas` con letra `micro` en `text-muted`.

| Punto de quiebre | Ancho mínimo | Columnas | Margen lateral |
|---|---|---|---|
| Móvil | 0 px | 4 | 16 px |
| Tablet | 768 px | 8 | 40 px |
| Escritorio | 1024 px | 12 | 80 px |
| Pantalla amplia | 1440 px | 12 | Centrado |

- Ancho máximo del contenido: **1200 px**. Las bandas de fondo y los medios pueden ocupar todo el ancho.
- Ancho máximo de texto de lectura: **720 px**.
- Nunca debe aparecer scroll horizontal en la página.

---

## 8. Formas y profundidad

| Token | Valor | Uso |
|---|---|---|
| `--radius-link` | 10 px | Enlaces con foco y elementos interactivos pequeños (mínimo) |
| `--radius-card` | 28 px | Tarjetas, imágenes y tarjetas de medios |
| `--radius-chip` | 36 px | Chips y filas de acordeón |
| `--radius-pill` | 9999 px | Botones y campos |

**No se usan sombras ni bordes** en tarjetas. La separación nace del cambio entre `#FFFFFF` y `#F5F5F7` y de los bordes redondeados de 28 px. Ningún elemento interactivo baja de 10 px de radio.

---

## 9. Componentes

### Navegación global

Barra fija de 44 px. Fondo blanco o transparente que pasa a `surface-nav` con `backdrop-filter: blur(20px)` al hacer scroll. Logo compacto a la izquierda, a 24 px de alto; enlaces en `micro`, color `text`, separados por 8–10 px.

### Navegación local

Barra de 52 px bajo la global, con el nombre de la sección en `body-strong` y enlaces en `micro`. La opción activa va en `text` con un subrayado fino; las demás en `text-muted`.

### Botones

| Variante | Fondo | Texto | Uso |
|---|---|---|---|
| Primario | `primary` | `on-primary` | Acción principal; uno por sección |
| Secundario | Transparente, borde 1 px `text` | `text` | Acción alternativa |
| Suave | `surface-wash` | `text` | Acciones frecuentes de poco énfasis |
| Texto | Transparente | `link`, con flecha `›` | Enlace de acción; subrayado solo al pasar el mouse |
| Destructivo | Transparente, borde 1 px `error` | `error` | Eliminar o acciones irreversibles; pide confirmación |

- Forma de píldora, con radio `--radius-pill`. Nunca esquinas rectas ni radios bajo 10 px.
- Texto `body` (17 px, peso 400), relleno de 11 × 16 px; altura mínima 44 px en móvil.
- Estados obligatorios: normal, hover, foco, activo, deshabilitado y cargando.
- Escribe el texto como verbo concreto: "Solicitar cotización", no "Aceptar".

### Acción del hero

Botón primario centrado y, debajo, una nota breve en `body` color `text-muted`.

### Encabezado de sección

Título en `section-heading` o `heading`, color `text`, alineado a la izquierda. Debajo, opcional, un párrafo en `body-lg` color `text-muted`.

### Tarjeta destacada

Fondo `paper` sobre banda `canvas` (o al revés), radio de 28 px, sin borde ni sombra, relleno de 28 a 40 px. Lleva un titular en `heading-sm` o `heading`, texto en `body` color `text-muted` y, opcional, una acción.

### Tarjeta de medios

Imagen o video con radio de 28 px, sin borde ni sombra. La imagen es el contenido: no lleva texto encima salvo que se asegure el contraste.

### Cifra destacada

Número en `heading` (56 px, peso 600–700, `tabular-nums`), color `text`, con su etiqueta debajo en `caption` color `text-muted`.

### Chip selector

Fondo transparente, texto y borde 1 px `text`, radio de 36 px. El elegido se rellena de `text` con texto blanco.

### Fila de acordeón

Fila sobre `canvas` con radio de 36 px, texto `text` e icono de más en círculo. La fila activa solo cambia su fondo a `surface-wash`.

### Insignia "Nuevo"

Solo texto, sin fondo ni forma: `badge` en `caption` peso 500, sobre el nombre del elemento.

### Paginación con puntos

Círculos de 8 px separados por 7 px: el activo en `text`, los inactivos en `#777779`.

### Campo de texto

- Fondo `paper`, texto `text`, borde de 1 px `hairline` (en hover, `text-muted`), radio de 10 px o píldora y altura de 44 px.
- Cada campo lleva una etiqueta visible; el placeholder no la reemplaza.
- Muestra el error debajo del campo y explica cómo corregirlo.

### Tablas de datos

Fondo `paper`, filas separadas por líneas `hairline`, encabezados en `caption` color `text-muted`, cifras alineadas a la derecha con `tabular-nums`.

### Estados de contenido

Toda vista con datos define los estados de carga, vacío y error. Un estado vacío explica qué ocurre y ofrece la siguiente acción.

---

## 10. Iconos e imágenes

- Iconos de línea monocromáticos de 1.5–2 px de trazo: **Lucide**, en 16, 20 y 24 px, color `glyph`.
- Los iconos sin texto necesitan una etiqueta accesible.
- Fotografía de camiones, carga y rutas con luz pareja y fondos limpios (blanco o gris claro), con recortes cerrados. La foto pone el color; la interfaz no.
- Sin ilustraciones ni gráficos decorativos.
- Si hay texto sobre una imagen, asegura el contraste oscureciendo o aclarando esa zona.
- Toda imagen informativa lleva texto alternativo; las decorativas usan `alt=""`.
- Usa SVG para gráficos y WebP o AVIF para fotografías.

---

## 11. Movimiento

| Token | Valor | Uso |
|---|---|---|
| `--duration-fast` | 120 ms | Hover y foco |
| `--duration-base` | 200 ms | Menús y acordeones |
| `--duration-slow` | 320 ms | Modales y paneles |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Curva general |

Anima con `transform` y `opacity`, con sobriedad. Respeta siempre `prefers-reduced-motion`.

---

## 12. Accesibilidad

Objetivo mínimo: **WCAG 2.2 nivel AA**.

| Combinación | Contraste | Uso permitido |
|---|---|---|
| Blanco sobre `#E00000` | 5.0:1 | Botones primarios |
| `#FF0000` sobre blanco | 4.0:1 | Solo títulos o detalles desde 24 px |
| `#707070` sobre `#FFFFFF` / `#F5F5F7` | 4.9:1 / 4.5:1 | Texto secundario; no usar sobre `#E8E8ED` |
| `#B64400` sobre blanco | 5.5:1 | Insignia "Nuevo" |
| `#D6D6D6` sobre blanco | 1.4:1 | Solo como línea decorativa; un campo se reconoce además por su etiqueta |

**Reglas generales**

- Contraste de 4.5:1 para texto normal y 3:1 para texto grande e iconos.
- Toda la interfaz debe funcionar con teclado.
- Foco visible con un anillo de 2 px en `focus`: nunca uses `outline: none` sin reemplazo.
- Las áreas táctiles en móvil miden al menos 44 × 44 px.
- Usa HTML semántico: `button`, `nav`, `main`, `label`.
- La página debe seguir funcionando con el texto ampliado al 200 %.

---

## 13. Voz y contenido

- Frases cortas, seguras y concretas. Un titular dice una sola idea.
- Las cifras hablan por la empresa: usa datos reales y verificables, no adjetivos como "increíble".
- Usa sentence case en botones y títulos normales: "Crear cuenta", no "Crear Cuenta".
- Los mensajes de error dicen qué pasó y cómo resolverlo, sin culpar a la persona.

---

## 14. Tokens listos para copiar

```css
:root {
  color-scheme: light;

  /* Superficies */
  --surface-paper: #FFFFFF;
  --surface-canvas: #F5F5F7;
  --surface-wash: #E8E8ED;
  --surface-nav: #FAFAFC;
  --surface-dark: #1D1D1F;

  /* Texto y bordes */
  --color-text: #1D1D1F;
  --color-text-muted: #707070;
  --color-text-nav: #474747;
  --color-hairline: #D6D6D6;
  --color-glyph: #1D1D1F;

  /* Color funcional */
  --color-brand: #FF0000;
  --color-primary: #E00000;
  --color-primary-hover: #B80000;
  --color-on-primary: #FFFFFF;
  --color-link: #1D1D1F;
  --color-focus: #1D1D1F;
  --color-badge: #B64400;
  --color-success: #1A7F37;
  --color-warning: #B25000;
  --color-error: #D70015;

  /* Tipografía */
  --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;

  /* Espaciado */
  --space-4: 0.25rem;
  --space-8: 0.5rem;
  --space-12: 0.75rem;
  --space-16: 1rem;
  --space-20: 1.25rem;
  --space-28: 1.75rem;
  --space-40: 2.5rem;
  --space-48: 3rem;
  --space-80: 5rem;
  --space-120: 7.5rem;

  /* Formas */
  --radius-link: 10px;
  --radius-card: 28px;
  --radius-chip: 36px;
  --radius-pill: 9999px;

  /* Movimiento */
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}

/* Banda o tarjeta oscura puntual (foto o video) */
.surface-dark {
  color-scheme: dark;
  background: var(--surface-dark);
  --color-text: #F5F5F7;
  --color-text-muted: #A1A1A6;
  --color-glyph: #F5F5F7;
  --color-link: #F5F5F7;
  --color-focus: #FFFFFF;
  color: var(--color-text);
}

body {
  margin: 0;
  background: var(--surface-paper);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 1.0625rem;
  line-height: 1.47;
  letter-spacing: -0.374px;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 { font-weight: 600; }

a {
  color: var(--color-link);
  text-decoration: underline;
}

:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 15. Reglas de trabajo

1. Usa los tokens existentes en lugar de valores directos.
2. Reutiliza componentes antes de crear otros nuevos.
3. Incluye el logo según la sección 3, y no uses logos, nombres, imágenes ni textos de otras marcas.
4. Incluye los estados de hover, foco, deshabilitado, carga, vacío y error.
5. Comprueba el resultado en móvil y escritorio, sobre bandas blancas y grises.
6. Consulta antes de salirte de esta guía y registra cualquier excepción en los datos del proyecto.

---

## 16. Lista de revisión

- [ ] El logo aparece en navegación, inicio de sesión y pie de página, en la versión correcta.
- [ ] El favicon usa el icono de la marca.
- [ ] Colores, fuentes y espacios provienen de los tokens.
- [ ] El fondo es claro y las secciones alternan `#FFFFFF` y `#F5F5F7`, sin líneas divisorias.
- [ ] `primary` (rojo) aparece solo en acciones, una vez por sección; no hay otro color de acento.
- [ ] Las tarjetas no tienen sombras ni bordes y usan radio de 28 px.
- [ ] Botones en píldora; ningún elemento interactivo con radio bajo 10 px.
- [ ] La jerarquía de títulos es correcta y los párrafos largos van a la izquierda.
- [ ] Funciona en móvil, tablet y escritorio, sin scroll horizontal.
- [ ] Se puede usar por completo con teclado y el foco es visible.
- [ ] El contraste cumple WCAG AA.
- [ ] Existen estados de carga, vacío y error.
- [ ] Las imágenes tienen texto alternativo y están optimizadas.
