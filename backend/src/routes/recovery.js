const { Router } = require('express');
const v = require('../validation');
const { CONDUCTOR, NAME } = require('../services/checklist');

// Plan de recuperación de la flota: lo malo de cada camión en un solo lugar, cada problema con la zona del camión donde
// está (el modelo 3D la marca). Las fallas vienen del último checklist (mecánico o conductor); además los daños de la
// última inspección, las mantenciones por km y el estado en panne. Las OT no son problemas: se muestran junto a su falla.

// Zona por palabras de la OT (tipo y descripción). El orden importa: «aceite de diferencial» es transmisión, no motor.
const WORDS = [
  ['frio', /fr[ií]o|termo|carrier|thermo ?king/i],
  ['frenos', /fren|pastilla|balata|disco|tambor/i],
  ['neumaticos', /neum[aá]tic|rueda|llanta|pinch/i],
  ['luces', /\bluz|luces|foco|faro|intermitente|ampolleta/i],
  ['refrigeracion', /radiador|refrigerante|temperatura|recalient|calienta|bomba de agua/i],
  ['bateria', /bater[ií]a|partida|arranque|alternador|el[eé]ctric/i],
  ['direccion', /direcci[oó]n|suspensi[oó]n|amortiguador|resorte|tren delantero|r[oó]tula|terminal/i],
  ['transmision', /embrague|caja de cambio|card[aá]n|cruceta|diferencial|transmisi/i],
  ['fugas', /fuga|gotea|derrame/i],
  ['parabrisas', /parabrisas|plumilla|vidrio/i],
  ['puertas', /puerta|bisagra|cerradura|chapa/i],
  ['cabina', /cabina|cintur[oó]n|alzavidrio|manilla|aire acondicionado|calefacci|asiento/i],
  ['documentos', /revisi[oó]n t[eé]cnica|permiso de circulaci|soap|document/i],
  ['carroceria', /carrocer|pintura|abolladura|choque|golpe|parachoque|espejo/i],
  ['motor', /motor|aceite|filtro|inyector|turbo|correa|mantenci[oó]n/i],
];
const zoneOf = text => WORDS.find(([, re]) => re.test(text))?.[0] || 'general';

// Ítems de la hoja de los mecánicos (y los del conductor) → zona y si es crítico (no debería salir a ruta así).
const SHEET = {
  '1.1': 'carroceria', '1.2': 'luces', '1.3': 'neumaticos', '1.4': 'parabrisas', '1.5': 'transmision', '1.6': 'transmision',
  '2.1': 'motor', '2.2': 'refrigeracion', '2.3': 'transmision', '2.4': 'fugas', '2.5': 'motor',
  '3.1': 'bateria', '3.2': 'bateria', '3.3': 'bateria', '4.1': 'frenos', '4.2': 'direccion',
  '5.1': 'cabina', '5.2': 'cabina', '5.3': 'cabina', '6.1': 'documentos', '6.2': 'documentos', '6.3': 'documentos',
  C1: 'neumaticos', C2: 'frenos', C3: 'luces', C4: 'motor', C5: 'refrigeracion', C6: 'fugas', C7: 'direccion',
  C8: 'bateria', C9: 'frio', C10: 'parabrisas', C11: 'carroceria', C12: 'cabina', C13: 'general',
};
const CRITICAL = new Set(['1.3', '2.1', '2.2', '4.1', '4.2', '6.1', '6.2', '6.3', ...CONDUCTOR.filter(c => ['urgente', 'alta'].includes(c.prioridad)).map(c => c.codigo)]);
// OT sugerida cuando el problema aún no tiene una.
const ACTION = {
  motor: 'Revisar motor', refrigeracion: 'Revisar sistema de refrigeración', luces: 'Revisar luces', neumaticos: 'Revisar neumáticos',
  frenos: 'Revisar frenos', direccion: 'Revisar dirección y suspensión', bateria: 'Revisar batería y motor de partida',
  transmision: 'Revisar embrague y transmisión', fugas: 'Revisar fuga de fluidos', frio: 'Revisar equipo de frío',
  parabrisas: 'Revisar parabrisas y plumillas', carroceria: 'Reparar carrocería', puertas: 'Reparar puertas de la caja',
  cabina: 'Revisar cabina', documentos: 'Renovar documentación', general: 'Revisar problema reportado',
};
const DAMAGE = { rayon: 'Rayón', abolladura: 'Abolladura', quebrado: 'Quebrado', falta_pieza: 'Falta pieza', otro: 'Daño' };
const SIDE = { frente: 'el frente', posterior: 'la parte posterior', izquierdo: 'el lado izquierdo', derecho: 'el lado derecho' };
const fmt = d => String(d).slice(0, 10).split('-').reverse().join('-');

module.exports = function recovery(pool, auth) {
  const router = Router();
  router.get('/flota/recuperacion', auth.allow('admin', 'encargado', 'jefe'), async (req, res) => {
    const today = v.today();
    const [[trucks], [tasks], [checks], [damages], [plans]] = await Promise.all([
      pool.execute('SELECT patente, numero, modelo, estado_operativo, prioridad, km_actual FROM camiones ORDER BY patente'),
      pool.execute(`SELECT id, patente_camion AS patente, tipo_tarea, descripcion, estado, prioridad, DATE_FORMAT(fecha_limite, '%Y-%m-%d') AS fecha_limite, esperando_repuesto, cotizando
        FROM tareas WHERE estado IN ('Pendiente', 'En_Trabajo') ORDER BY id`),
      // El último checklist de cada camión (30 días): es el estado más reciente, sea del mecánico o del conductor.
      pool.execute(`SELECT c.id, c.patente, DATE_FORMAT(c.fecha, '%Y-%m-%d') AS fecha, c.items, c.observaciones, c.conductor, COALESCE(u.nombre, c.conductor) AS responsable
        FROM checklists c LEFT JOIN usuarios u ON u.id = c.id_usuario
        WHERE c.id IN (SELECT MAX(id) FROM checklists WHERE fecha > DATE_SUB(?, INTERVAL 30 DAY) GROUP BY patente)`, [today]),
      pool.execute(`SELECT d.id, i.patente_camion AS patente, DATE_FORMAT(i.fecha, '%Y-%m-%d') AS fecha, d.vista, d.x, d.y, d.tipo, d.nota
        FROM inspeccion_danos d JOIN inspecciones_camion i ON i.id = d.id_inspeccion
        WHERE i.id IN (SELECT MAX(id) FROM inspecciones_camion GROUP BY patente_camion) ORDER BY d.id`),
      pool.execute(`SELECT c.patente, c.km_actual, p.id, p.nombre, p.cada_km, cp.km_ultimo
        FROM camiones c CROSS JOIN planes_mantencion p JOIN camion_planes cp ON cp.patente = c.patente AND cp.id_plan = p.id
        WHERE c.km_actual IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.patente_camion = c.patente AND t.id_plan = p.id AND t.estado <> 'Aprobada')`),
    ]);
    const byTruck = new Map(trucks.map(t => [t.patente, []]));
    const add = (patente, problem) => byTruck.get(patente)?.push(problem);

    // Las OT no son problemas por sí mismas: la falla viene del checklist. Si ya hay una OT abierta para esa parte, se muestra junto a la falla.
    const otOf = (patente, zona) => tasks.find(t => t.patente === patente && zoneOf(`${t.tipo_tarea} ${t.descripcion || ''}`) === zona)
    const otState = t => t.estado === 'En_Trabajo' ? 'en trabajo' : t.cotizando ? 'cotizando repuestos' : t.esperando_repuesto ? 'esperando repuesto' : 'pendiente';
    for (const c of checks) {
      const items = typeof c.items === 'string' ? JSON.parse(c.items) : c.items;
      for (const i of items.filter(i => i.estado === 'falla')) {
        const zona = SHEET[i.codigo] || 'general';
        const ot = otOf(c.patente, zona);
        add(c.patente, {
          id: `ck-${c.id}-${i.codigo}`, zona, gravedad: CRITICAL.has(i.codigo) ? 'critico' : 'atencion', titulo: NAME[i.codigo] || i.codigo, detalle: i.obs || null,
          origen: `${c.conductor ? 'Checklist del conductor' : 'Checklist del mecánico'} ${c.responsable || ''} · ${fmt(c.fecha)}`.replace(/\s+·/, ' ·') + (ot ? ` · OT #${ot.id} abierta (${otState(ot)})` : ''),
          ...(ot ? { id_tarea: ot.id } : {}),
          sugerida: { tipo_tarea: CONDUCTOR.find(x => x.codigo === i.codigo)?.tarea || ACTION[zona], prioridad: CRITICAL.has(i.codigo) ? 'alta' : 'media',
            descripcion: `${c.conductor ? `Reportado por ${c.responsable} al terminar la ruta` : `Checklist de ${c.responsable}`} (${fmt(c.fecha)}): ${NAME[i.codigo] || i.codigo}${i.obs ? ` · ${i.obs}` : ''}.` },
        });
      }
    }
    for (const d of damages) {
      const what = `${DAMAGE[d.tipo] || 'Daño'} en ${SIDE[d.vista]}`;
      add(d.patente, {
        id: `dn-${d.id}`, zona: 'carroceria', gravedad: 'atencion', titulo: what, detalle: d.nota || null, origen: `Inspección de daños · ${fmt(d.fecha)}`,
        marca: { vista: d.vista, x: Number(d.x), y: Number(d.y) },
        sugerida: { tipo_tarea: ACTION.carroceria, prioridad: 'media', descripcion: `${what} (inspección del ${fmt(d.fecha)})${d.nota ? `: ${d.nota}` : ''}.` },
      });
    }
    for (const p of plans) {
      const done = p.km_actual - p.km_ultimo;
      if (done < p.cada_km * 0.9) continue;
      const over = done - p.cada_km, km = n => Number(n).toLocaleString('es-CL');
      add(p.patente, {
        id: `km-${p.patente}-${p.id}`, zona: 'motor', gravedad: over >= 0 ? 'critico' : 'atencion', titulo: p.nombre,
        detalle: over >= 0 ? `Se pasó por ${km(over)} km: le tocaba a los ${km(p.km_ultimo + p.cada_km)} km.` : `Faltan ${km(-over)} km (le toca a los ${km(p.km_ultimo + p.cada_km)} km).`,
        origen: `Mantención por km · va en ${km(p.km_actual)} km`,
        sugerida: { tipo_tarea: p.nombre, prioridad: over >= 0 ? 'alta' : 'media', tipo_mantencion: 'preventiva', id_plan: p.id, descripcion: `${p.nombre}: el camión va en ${km(p.km_actual)} km.` },
      });
    }

    const order = { critico: 0, atencion: 1 };
    const camiones = trucks.map(t => {
      const problemas = byTruck.get(t.patente).sort((a, b) => order[a.gravedad] - order[b.gravedad]);
      const estado = t.estado_operativo === 'panne' ? 'detenido' : problemas.some(p => p.gravedad === 'critico') ? 'critico' : problemas.length ? 'atencion' : 'ok';
      return { ...t, estado, problemas };
    });
    const rank = { detenido: 0, critico: 1, atencion: 2, ok: 3 };
    camiones.sort((a, b) => rank[a.estado] - rank[b.estado] || b.problemas.length - a.problemas.length || a.patente.localeCompare(b.patente));
    res.json({ success: true, hoy: today, camiones });
  });
  return router;
};
module.exports.zoneOf = zoneOf;
