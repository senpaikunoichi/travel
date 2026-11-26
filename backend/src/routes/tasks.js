const { Router } = require('express');
const { move } = require('../services/stock');
const v = require('../validation');
const { transaction } = require('../db');
const fs = require('node:fs/promises');
const path = require('node:path');
const { notify } = require('../services/notify');
const { logEvent } = require('../services/events');

const taskSelect = `SELECT t.*, c.numero, c.modelo, c.prioridad AS prioridad_camion, c.km_actual,
  (SELECT GROUP_CONCAT(tm.id_mecanico) FROM tarea_mecanicos tm WHERE tm.id_tarea = t.id) AS mecanicos_ids,
  (SELECT GROUP_CONCAT(u.nombre ORDER BY u.nombre SEPARATOR ', ') FROM tarea_mecanicos tm JOIN usuarios u ON u.id = tm.id_mecanico WHERE tm.id_tarea = t.id) AS mecanicos_nombres
  FROM tareas t JOIN camiones c ON t.patente_camion = c.patente`;
// Datos comunes de crear y editar una tarea.
function parseTask(body) {
  const fields = {
    tipo_tarea: v.text(body.tipo_tarea, 'Tipo de tarea', 100),
    patente_camion: v.text(body.patente_camion, 'Patente', 10),
    descripcion: v.text(body.descripcion, 'Descripción', 10000, true),
    fecha_limite: v.date(body.fecha_limite),
    tipo_mantencion: v.oneOf(body.tipo_mantencion, ['preventiva', 'correctiva', 'inspeccion'], 'Tipo de mantención', 'correctiva'),
    prioridad: v.oneOf(body.prioridad, ['baja', 'media', 'alta', 'urgente'], 'Prioridad', 'media'),
    kilometraje: v.km(body.kilometraje),
  };
  if (!Array.isArray(body.mecanicos) || !body.mecanicos.length || body.mecanicos.length > 100) throw new v.HttpError(400, 'Selecciona entre 1 y 100 mecánicos.');
  const mechanics = [...new Set(body.mecanicos.map(v.id))];
  const lines = body.repuestos ?? [];
  if (!Array.isArray(lines) || lines.length > 50) throw new v.HttpError(400, 'Agrega hasta 50 repuestos.');
  const parts = lines.map(line => {
    if (!line || typeof line !== 'object') throw new v.HttpError(400, 'Repuesto inválido.');
    const id_repuesto = line.id_repuesto ? v.id(line.id_repuesto) : null;
    return { id: line.id ? v.id(line.id) : null, id_repuesto, descripcion: id_repuesto ? null : v.text(line.descripcion, 'Repuesto', 200), cantidad: v.quantity(line.cantidad) };
  });
  return { fields, mechanics, parts, id_plan: body.id_plan ? v.id(body.id_plan) : null };
}
async function checkRefs(db, { fields, mechanics, parts }) {
  const [trucks] = await db.execute('SELECT patente FROM camiones WHERE patente = ? FOR UPDATE', [fields.patente_camion]);
  if (!trucks.length) throw new v.HttpError(400, 'El camión no existe.');
  const [users] = await db.execute(`SELECT id FROM usuarios WHERE rol = 'mecanico' AND id IN (${mechanics.map(() => '?').join(',')}) FOR UPDATE`, mechanics);
  if (users.length !== mechanics.length) throw new v.HttpError(400, 'Uno o más mecánicos no existen o no tienen el rol correcto.');
  const ids = [...new Set(parts.map(p => p.id_repuesto).filter(Boolean))];
  if (ids.length) {
    const [found] = await db.execute(`SELECT id FROM repuestos WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    if (found.length !== ids.length) throw new v.HttpError(400, 'Uno o más repuestos no existen en el inventario.');
  }
}
const insertPart = (db, taskId, p) => db.execute('INSERT INTO tarea_repuestos (id_tarea, id_repuesto, descripcion, cantidad) VALUES (?, ?, ?, ?)', [taskId, p.id_repuesto, p.descripcion, p.cantidad]);
// Al aprobar una mantención por kilometraje, su plan vuelve a contar desde el km de la tarea.
async function approved(db, task) {
  if (!task.id_plan) return;
  await db.execute('UPDATE camion_planes cp JOIN camiones c ON c.patente = cp.patente SET cp.km_ultimo = COALESCE(?, c.km_actual, cp.km_ultimo), cp.avisado = FALSE, cp.avisado_pronto = FALSE WHERE cp.patente = ? AND cp.id_plan = ?', [task.kilometraje, task.patente_camion, task.id_plan]);
}

module.exports = function tasks(pool, auth, config) {
  const router = Router();
  router.get('/tareas', auth.allow('admin', 'encargado', 'jefe'), async (req, res) => {
    const [tareas] = await pool.execute(`${taskSelect} ORDER BY t.fecha_creacion DESC, t.id DESC`);
    res.json({ success: true, tareas });
  });
  router.get('/tareas/mecanico/:id', async (req, res) => {
    const mechanic = v.id(req.params.id);
    if (req.usuario.rol === 'mecanico' && mechanic !== req.usuario.id) throw new v.HttpError(403, 'Solo puedes consultar tus tareas.');
    const [tareas] = await pool.execute(`${taskSelect} WHERE EXISTS (SELECT 1 FROM tarea_mecanicos tm WHERE tm.id_tarea = t.id AND tm.id_mecanico = ?) ORDER BY t.fecha_creacion DESC, t.id DESC`, [mechanic]);
    res.json({ success: true, tareas });
  });
  // Historial de la OT (línea de tiempo). El mecánico lo ve sin montos.
  const history = async (db, taskId, user) => {
    const [eventos] = await db.execute('SELECT e.id, e.tipo, e.detalle, e.monto, e.created_at, u.nombre AS usuario, u.rol FROM tarea_eventos e LEFT JOIN usuarios u ON u.id = e.id_usuario WHERE e.id_tarea = ? ORDER BY e.id', [taskId]);
    return user.rol === 'mecanico' ? eventos.map(e => ({ ...e, monto: null })) : eventos;
  };
  router.get('/tareas/:id/historial', async (req, res) => {
    const taskId = v.id(req.params.id);
    await auth.taskAccess(pool, req.usuario, taskId);
    res.json({ success: true, eventos: await history(pool, taskId, req.usuario) });
  });
  // Informe completo de una OT para la oficina: datos, repuestos, evidencias, cotizaciones, costos e historial.
  router.get('/tareas/:id/informe', auth.allow('admin', 'encargado', 'jefe'), async (req, res) => {
    const taskId = v.id(req.params.id);
    await auth.taskAccess(pool, req.usuario, taskId);
    const [[[tarea]], [repuestos], [evidencias], [cotizaciones], [gastos]] = await Promise.all([
      pool.execute(`${taskSelect} WHERE t.id = ?`, [taskId]),
      pool.execute('SELECT tr.id, tr.descripcion, tr.cantidad, tr.estado, tr.motivo, r.nombre, r.codigo, r.unidad FROM tarea_repuestos tr LEFT JOIN repuestos r ON r.id = tr.id_repuesto WHERE tr.id_tarea = ? ORDER BY tr.id', [taskId]),
      pool.execute('SELECT id, ruta_archivo, tipo, fecha, id_tarea_repuesto, id_cotizacion FROM evidencia WHERE id_tarea = ? ORDER BY id', [taskId]),
      pool.execute('SELECT c.*, u.nombre AS creador, d.nombre AS decisor FROM cotizaciones c LEFT JOIN usuarios u ON u.id = c.created_by LEFT JOIN usuarios d ON d.id = c.decided_by WHERE c.id_tarea = ? ORDER BY c.id', [taskId]),
      pool.execute('SELECT id, concepto, monto, tipo, fecha FROM gastos WHERE id_tarea = ? ORDER BY fecha, id', [taskId]),
    ]);
    res.json({ success: true, tarea, repuestos, evidencias, cotizaciones, gastos, eventos: await history(pool, taskId, req.usuario) });
  });
  router.post('/tareas/crear', auth.allow('admin', 'encargado'), async (req, res) => {
    const data = parseTask(req.body);
    const tarea_id = await transaction(pool, async db => {
      await checkRefs(db, data);
      const f = data.fields;
      const [result] = await db.execute("INSERT INTO tareas (tipo_tarea, patente_camion, descripcion, fecha_creacion, fecha_limite, created_by, estado, tipo_mantencion, prioridad, kilometraje, id_plan) VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?)", [f.tipo_tarea, f.patente_camion, f.descripcion, v.today(), f.fecha_limite, req.usuario.id, f.tipo_mantencion, f.prioridad, f.kilometraje, data.id_plan]);
      for (const mechanic of data.mechanics) await db.execute('INSERT INTO tarea_mecanicos (id_tarea, id_mecanico) VALUES (?, ?)', [result.insertId, mechanic]);
      for (const part of data.parts) await insertPart(db, result.insertId, part);
      await notify(db, data.mechanics, `Nueva tarea asignada: ${f.tipo_tarea} (${f.patente_camion}).`, result.insertId);
      const [names] = data.mechanics.length ? await db.query('SELECT nombre FROM usuarios WHERE id IN (?)', [data.mechanics]) : [[]];
      await logEvent(db, result.insertId, req.usuario, 'creada', `Creó la OT y la asignó a ${names.map(n => n.nombre).join(', ') || 'nadie aún'}. ${data.parts.length} repuesto(s) solicitados.`);
      return result.insertId;
    });
    res.status(201).json({ success: true, tarea_id, mensaje: 'Tarea creada.' });
  });
  // Supervisores, jefes y administradores corrigen la tarea; solo se reemplazan los repuestos aún no retirados.
  router.put('/tareas/editar/:id', auth.allow('admin', 'encargado', 'jefe'), async (req, res) => {
    const taskId = v.id(req.params.id), data = parseTask(req.body);
    await transaction(pool, async db => {
      const task = await auth.taskAccess(db, req.usuario, taskId, true);
      if (task.estado === 'Aprobada') throw new v.HttpError(409, 'La tarea ya está aprobada y no se puede editar.');
      await checkRefs(db, data);
      const f = data.fields;
      await db.execute('UPDATE tareas SET tipo_tarea = ?, patente_camion = ?, descripcion = ?, fecha_limite = ?, tipo_mantencion = ?, prioridad = ?, kilometraje = ? WHERE id = ?', [f.tipo_tarea, f.patente_camion, f.descripcion, f.fecha_limite, f.tipo_mantencion, f.prioridad, f.kilometraje, taskId]);
      const [current] = await db.execute('SELECT id_mecanico FROM tarea_mecanicos WHERE id_tarea = ?', [taskId]);
      const before = new Set(current.map(row => row.id_mecanico));
      await db.execute('DELETE FROM tarea_mecanicos WHERE id_tarea = ?', [taskId]);
      for (const mechanic of data.mechanics) await db.execute('INSERT INTO tarea_mecanicos (id_tarea, id_mecanico) VALUES (?, ?)', [taskId, mechanic]);
      const added = data.mechanics.filter(m => !before.has(m));
      if (added.length) await notify(db, added, `Nueva tarea asignada: ${f.tipo_tarea} (${f.patente_camion}).`, taskId);
      const [lines] = await db.execute('SELECT id, estado FROM tarea_repuestos WHERE id_tarea = ? FOR UPDATE', [taskId]);
      const kept = new Set(data.parts.map(p => p.id).filter(Boolean));
      for (const line of lines) if (line.estado === 'pendiente' && !kept.has(line.id)) await db.execute('DELETE FROM tarea_repuestos WHERE id = ?', [line.id]);
      for (const part of data.parts) {
        const line = part.id && lines.find(l => l.id === part.id);
        if (!part.id) await insertPart(db, taskId, part);
        else if (!line) throw new v.HttpError(400, 'Un repuesto no pertenece a esta tarea.');
        else if (line.estado === 'pendiente') await db.execute('UPDATE tarea_repuestos SET id_repuesto = ?, descripcion = ?, cantidad = ? WHERE id = ?', [part.id_repuesto, part.descripcion, part.cantidad, part.id]);
      }
      await logEvent(db, taskId, req.usuario, 'editada', 'Editó los datos de la OT.');
    });
    res.json({ success: true, mensaje: 'Tarea actualizada.' });
  });
  router.put('/tareas/estado/:id', auth.allow('mecanico', 'encargado', 'admin'), async (req, res) => {
    const taskId = v.id(req.params.id), state = req.body.estado;
    const note = typeof req.body.observaciones === 'string' && req.body.observaciones.trim() ? req.body.observaciones.trim().slice(0, 2000) : null;
    const transitions = { En_Trabajo: { from: 'Pendiente', roles: ['mecanico', 'admin'] }, Completada: { from: 'En_Trabajo', roles: ['mecanico', 'admin'] }, Aprobada: { from: 'Completada', roles: ['encargado', 'admin'] } };
    const transition = typeof state === 'string' && Object.hasOwn(transitions, state) ? transitions[state] : null;
    if (!transition) throw new v.HttpError(400, 'Estado inválido.');
    if (!transition.roles.includes(req.usuario.rol)) throw new v.HttpError(403, 'No puedes realizar este cambio de estado.');
    const missing = await transaction(pool, async db => {
      const task = await auth.taskAccess(db, req.usuario, taskId, true);
      if (task.estado !== transition.from) throw new v.HttpError(409, 'La tarea cambió de estado. Actualiza el panel antes de continuar.');
      if (state === 'Completada') {
        const [[checklist]] = await db.execute('SELECT id FROM checklists WHERE id_tarea = ?', [taskId]);
        if (!checklist) throw new v.HttpError(409, 'Llena el checklist de salida antes de marcar la tarea realizada.');
      }
      if (state === 'Completada' && task.cotizando) throw new v.HttpError(409, 'La tarea está en cotización: el supervisor la retomará cuando llegue el repuesto.');
      if (state === 'Completada' && task.esperando_repuesto) throw new v.HttpError(409, 'Esperando repuesto: el supervisor aún no registra la compra. Podrás continuar cuando llegue.');
      await db.execute('UPDATE tareas SET estado = ?, fecha_completada = COALESCE(?, fecha_completada) WHERE id = ?', [state, state === 'Completada' ? v.today() : null, taskId]);
      if (state === 'Completada' && note) await db.execute('UPDATE tareas SET observaciones = ? WHERE id = ?', [note, taskId]);
      if (state === 'Aprobada') await approved(db, task);
      if (state === 'En_Trabajo') await notify(db, ['encargado'], `Tarea iniciada: ${task.tipo_tarea} (${task.patente_camion}) por ${req.usuario.nombre}.`, taskId);
      if (state === 'Completada') await notify(db, ['encargado'], `Tarea lista para revisión: ${task.tipo_tarea} (${task.patente_camion}).`, taskId);
      await logEvent(db, taskId, req.usuario, { En_Trabajo: 'iniciada', Completada: 'enviada_revision', Aprobada: 'aprobada' }[state], { En_Trabajo: 'Inició el trabajo.', Completada: `Marcó la OT como realizada${note ? `: ${note}` : '.'}`, Aprobada: 'Aprobó el trabajo y cerró la OT.' }[state]);
      if (state !== 'En_Trabajo') return 0;
      // Al iniciar se retiran del inventario los repuestos con stock suficiente; el resto queda pendiente.
      const [lines] = await db.execute("SELECT tr.id, tr.cantidad, r.id AS repuesto, r.stock FROM tarea_repuestos tr JOIN repuestos r ON r.id = tr.id_repuesto WHERE tr.id_tarea = ? AND tr.estado = 'pendiente' FOR UPDATE", [taskId]);
      let missing = 0;
      for (const line of lines) {
        const [[part]] = await db.execute('SELECT stock FROM repuestos WHERE id = ? FOR UPDATE', [line.repuesto]);
        if (Number(part.stock) < Number(line.cantidad)) { missing++; continue; }
        await move(db, { id_repuesto: line.repuesto, cantidad: -line.cantidad, motivo: `OT #${taskId} · ${task.tipo_tarea}`, id_tarea: taskId, patente: task.patente_camion, usuario: req.usuario });
        await db.execute("UPDATE tarea_repuestos SET estado = 'retirado' WHERE id = ?", [line.id]);
      }
      const [[{ freeText }]] = await db.execute("SELECT COUNT(*) AS freeText FROM tarea_repuestos WHERE id_tarea = ? AND estado = 'pendiente' AND id_repuesto IS NULL", [taskId]);
      return missing + Number(freeText);
    });
    res.json({ success: true, sin_stock: missing, mensaje: missing ? `Tarea iniciada. ${missing} repuesto(s) sin stock: revisa y usa «No hay repuesto» si corresponde.` : 'Estado actualizado.' });
  });
  router.post('/tareas/revisar/:id', auth.allow('encargado', 'admin'), async (req, res) => {
    const taskId = v.id(req.params.id), decision = req.body.decision;
    if (!['aprobar', 'rechazar'].includes(decision)) throw new v.HttpError(400, 'Decisión de revisión inválida.');
    const note = decision === 'rechazar' ? v.text(req.body.nota, 'Motivo del rechazo', 2000) : null;
    await transaction(pool, async db => {
      const task = await auth.taskAccess(db, req.usuario, taskId, true);
      if (task.estado !== 'Completada') throw new v.HttpError(409, 'La tarea ya no está pendiente de revisión. Actualiza el panel.');
      if (decision === 'aprobar') {
        await db.execute("UPDATE tareas SET estado = 'Aprobada' WHERE id = ?", [taskId]);
        await approved(db, task);
        await logEvent(db, taskId, req.usuario, 'aprobada', 'Aprobó el trabajo y cerró la OT.');
      } else {
        await db.execute("UPDATE tareas SET estado = 'En_Trabajo', nota_rechazo = ?, fecha_rechazo = UTC_TIMESTAMP(), veces_rechazada = COALESCE(veces_rechazada, 0) + 1 WHERE id = ?", [note, taskId]);
        const [assigned] = await db.execute('SELECT id_mecanico FROM tarea_mecanicos WHERE id_tarea = ?', [taskId]);
        await notify(db, assigned.map(a => a.id_mecanico), `Corrección solicitada: ${task.tipo_tarea} (${task.patente_camion}).`, taskId);
        await logEvent(db, taskId, req.usuario, 'devuelta', `Devolvió la OT al mecánico: ${note}`);
      }
    });
    res.json({ success: true, mensaje: decision === 'aprobar' ? 'Tarea aprobada.' : 'Tarea rechazada y devuelta al mecánico.' });
  });
  router.post('/tareas/verificar-vencidas', auth.allow('mecanico', 'encargado', 'admin'), async (req, res) => {
    const day = v.today();
    const scope = req.usuario.rol === 'mecanico' ? ' AND EXISTS (SELECT 1 FROM tarea_mecanicos tm WHERE tm.id_tarea = tareas.id AND tm.id_mecanico = ?)' : '';
    // Cada vencimiento aplaza un día más; al mover la fecha a mañana, repetir la verificación hoy no vuelve a contar.
    const [result] = await pool.execute(`UPDATE tareas SET fecha_limite = ?, vencida = TRUE, veces_aplazada = COALESCE(veces_aplazada, 0) + 1 WHERE fecha_limite < ? AND estado NOT IN ('Completada', 'Aprobada') AND NOT cotizando${scope}`, [v.tomorrow(day), day, ...(scope ? [req.usuario.id] : [])]);
    res.json({ success: true, tareas_pospuestas: result.affectedRows });
  });
  // El supervisor pone o quita «Cotizando»: mientras tanto la tarea no se aplaza ni cuenta como atrasada.
  router.put('/tareas/:id/cotizando', auth.allow('encargado', 'admin'), async (req, res) => {
    const taskId = v.id(req.params.id), on = req.body.activo === true;
    await transaction(pool, async db => {
      const task = await auth.taskAccess(db, req.usuario, taskId, true);
      if (!['Pendiente', 'En_Trabajo'].includes(task.estado)) throw new v.HttpError(409, 'Solo una tarea abierta puede quedar en cotización.');
      if (!!task.cotizando === on) return;
      const day = v.today();
      if (on) await db.execute('UPDATE tareas SET cotizando = TRUE, cotizando_desde = ? WHERE id = ?', [day, taskId]);
      else await db.execute('UPDATE tareas SET fecha_limite = DATE_ADD(fecha_limite, INTERVAL GREATEST(0, DATEDIFF(?, cotizando_desde)) DAY), cotizando = FALSE, cotizando_desde = NULL WHERE id = ?', [day, taskId]);
      await logEvent(db, taskId, req.usuario, 'cotizando', on ? 'Puso la OT en cotización.' : 'Retomó la OT: terminó la cotización.');
    });
    res.json({ success: true, mensaje: on ? 'Tarea en cotización: no se atrasará mientras tanto.' : 'Tarea retomada: la fecha límite se corrió los días en cotización.' });
  });
  router.put('/tareas/motivo-aplazamiento/:id', auth.allow('mecanico', 'encargado', 'admin'), async (req, res) => {
    const taskId = v.id(req.params.id), reason = v.text(req.body.motivo, 'Motivo', 10000);
    await transaction(pool, async db => {
      const task = await auth.taskAccess(db, req.usuario, taskId, true);
      if (!task.vencida) throw new v.HttpError(409, 'La tarea no está aplazada.');
      await db.execute('UPDATE tareas SET motivo_aplazamiento = ? WHERE id = ?', [reason, taskId]);
      await logEvent(db, taskId, req.usuario, 'aplazada', `Motivo del atraso: ${reason}`);
    });
    res.json({ success: true, mensaje: 'Motivo guardado.' });
  });
  // El administrador puede borrar cualquier tarea: se eliminan también sus gastos, archivos, repuestos y cotizaciones.
  router.delete('/tareas/eliminar/:id', auth.allow('admin'), async (req, res) => {
    const taskId = v.id(req.params.id);
    const files = await transaction(pool, async db => {
      await auth.taskAccess(db, req.usuario, taskId, true);
      const [evidence] = await db.execute('SELECT ruta_archivo FROM evidencia WHERE id_tarea = ?', [taskId]);
      const [quotes] = await db.execute('SELECT ruta_archivo FROM cotizaciones WHERE id_tarea = ? AND ruta_archivo IS NOT NULL', [taskId]);
      const [receipts] = await db.execute('SELECT ruta_comprobante AS ruta_archivo FROM cotizaciones WHERE id_tarea = ? AND ruta_comprobante IS NOT NULL', [taskId]);
      const rows = [...evidence, ...quotes, ...receipts];
      for (const table of ['cotizaciones', 'tarea_repuestos', 'gastos', 'evidencia', 'tarea_mecanicos', 'notificaciones', 'tarea_eventos']) await db.execute(`DELETE FROM ${table} WHERE id_tarea = ?`, [taskId]);
      await db.execute('DELETE FROM tareas WHERE id = ?', [taskId]);
      return rows.map(row => path.basename(row.ruta_archivo));
    });
    for (const name of files) await fs.unlink(path.join(config.uploads, name)).catch(() => {});
    res.json({ success: true, mensaje: 'Tarea y su historial eliminados.' });
  });
  // Los costos los ven solo la oficina (supervisor, jefe y administrador), nunca el mecánico.
  router.get('/gastos/:id_tarea', auth.allow('admin', 'encargado', 'jefe'), async (req, res) => {
    const taskId = v.id(req.params.id_tarea);
    await auth.taskAccess(pool, req.usuario, taskId);
    const [gastos] = await pool.execute('SELECT id, id_tarea, concepto, monto, tipo, fecha FROM gastos WHERE id_tarea = ? ORDER BY id', [taskId]);
    
    res.json({ success: true, gastos });
  });
  // Otros gastos de la tarea que no pasaron por una cotización: los registra y corrige el supervisor.
  const expenseEditor = auth.allow('encargado', 'admin');
  router.post('/gastos/manual', expenseEditor, async (req, res) => {
    const taskId = v.id(req.body.id_tarea), concepto = v.text(req.body.concepto, 'Concepto', 200), monto = v.amount(req.body.monto);
    const fecha = req.body.fecha ? v.date(req.body.fecha) : v.today();
    if (fecha > v.today()) throw new v.HttpError(400, 'La fecha del gasto no puede ser futura.');
    await auth.taskAccess(pool, req.usuario, taskId);
    await pool.execute("INSERT INTO gastos (id_tarea, concepto, monto, tipo, fecha) VALUES (?, ?, ?, 'factura', ?)", [taskId, concepto, monto, fecha]);
    await logEvent(pool, taskId, req.usuario, 'gasto', `Agregó el gasto: ${concepto}`, monto);
    res.status(201).json({ success: true, mensaje: 'Gasto agregado.' });
  });
  router.put('/gastos/:id', expenseEditor, async (req, res) => {
    const [result] = await pool.execute('UPDATE gastos SET monto = ? WHERE id = ?', [v.amount(req.body.monto), v.id(req.params.id)]);
    v.affected(result);
    res.json({ success: true, mensaje: 'Monto actualizado.' });
  });
  router.delete('/gastos/:id', expenseEditor, async (req, res) => {
    // Solo gastos manuales; las compras se registran desde su cotización.
    const [result] = await pool.execute("DELETE FROM gastos WHERE id = ? AND tipo = 'factura'", [v.id(req.params.id)]);
    v.affected(result);
    res.json({ success: true, mensaje: 'Gasto eliminado.' });
  });
  return router;
};
