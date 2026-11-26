const { Router } = require('express');
const v = require('../validation');
const { transaction } = require('../db');

module.exports = function tasks(pool, auth) {
  const router = Router();
  router.get('/tareas', auth.allow('admin', 'encargado', 'jefe'), async (req, res) => {
    const sql = req.usuario.rol === 'encargado'
      ? `SELECT t.*, c.numero, c.modelo, m.mecanicos
        FROM tareas t JOIN camiones c ON t.patente_camion = c.patente
        LEFT JOIN (SELECT tm.id_tarea, GROUP_CONCAT(u.nombre ORDER BY u.nombre SEPARATOR ', ') AS mecanicos
          FROM tarea_mecanicos tm JOIN usuarios u ON tm.id_mecanico = u.id GROUP BY tm.id_tarea) m ON m.id_tarea = t.id
        ORDER BY t.fecha_creacion DESC, t.id DESC`
      : 'SELECT t.*, c.numero, c.modelo FROM tareas t JOIN camiones c ON t.patente_camion = c.patente ORDER BY t.fecha_creacion DESC, t.id DESC';
    const [tareas] = await pool.execute(sql);
    res.json({ success: true, tareas });
  });
  router.get('/tareas/mecanico/:id', async (req, res) => {
    const mechanic = v.id(req.params.id);
    if (req.usuario.rol === 'mecanico' && mechanic !== req.usuario.id) throw new v.HttpError(403, 'Solo puedes consultar tus tareas.');
    const [tareas] = await pool.execute('SELECT t.*, c.numero, c.modelo FROM tareas t JOIN camiones c ON t.patente_camion = c.patente WHERE EXISTS (SELECT 1 FROM tarea_mecanicos tm WHERE tm.id_tarea = t.id AND tm.id_mecanico = ?) ORDER BY t.fecha_creacion DESC, t.id DESC', [mechanic]);
    res.json({ success: true, tareas });
  });
  router.post('/tareas/crear', auth.allow('admin', 'encargado'), async (req, res) => {
    const tipo = v.text(req.body.tipo_tarea, 'Tipo de tarea', 100), patente = v.text(req.body.patente_camion, 'Patente', 10), descripcion = v.text(req.body.descripcion, 'Descripción', 10000, true), limite = v.date(req.body.fecha_limite), prioridad = v.taskPriority(req.body.prioridad);
    if (!Array.isArray(req.body.mecanicos) || !req.body.mecanicos.length || req.body.mecanicos.length > 100) throw new v.HttpError(400, 'Selecciona entre 1 y 100 mecánicos.');
    const mechanics = [...new Set(req.body.mecanicos.map(v.id))];
    const tarea_id = await transaction(pool, async db => {
      const [trucks] = await db.execute('SELECT patente FROM camiones WHERE patente = ? FOR UPDATE', [patente]);
      if (!trucks.length) throw new v.HttpError(400, 'El camión no existe.');
      const [users] = await db.execute(`SELECT id FROM usuarios WHERE rol = 'mecanico' AND id IN (${mechanics.map(() => '?').join(',')}) FOR UPDATE`, mechanics);
      if (users.length !== mechanics.length) throw new v.HttpError(400, 'Uno o más mecánicos no existen o no tienen el rol correcto.');
      const [result] = await db.execute("INSERT INTO tareas (tipo_tarea, patente_camion, descripcion, fecha_creacion, fecha_limite, prioridad, created_by, estado) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente')", [tipo, patente, descripcion, v.today(), limite, prioridad, req.usuario.id]);
      for (const mechanic of mechanics) await db.execute('INSERT INTO tarea_mecanicos (id_tarea, id_mecanico) VALUES (?, ?)', [result.insertId, mechanic]);
      return result.insertId;
    });
    res.status(201).json({ success: true, tarea_id, mensaje: 'Tarea creada.' });
  });
  router.put('/tareas/estado/:id', auth.allow('mecanico', 'encargado', 'admin'), async (req, res) => {
    const taskId = v.id(req.params.id), state = req.body.estado;
    const transitions = { En_Trabajo: { from: 'Pendiente', roles: ['mecanico', 'admin'] }, Completada: { from: 'En_Trabajo', roles: ['mecanico', 'admin'] }, Aprobada: { from: 'Completada', roles: ['encargado', 'admin'] } };
    const transition = typeof state === 'string' && Object.hasOwn(transitions, state) ? transitions[state] : null;
    if (!transition) throw new v.HttpError(400, 'Estado inválido.');
    if (!transition.roles.includes(req.usuario.rol)) throw new v.HttpError(403, 'No puedes realizar este cambio de estado.');
    await transaction(pool, async db => {
      const task = await auth.taskAccess(db, req.usuario, taskId, true);
      if (task.estado !== transition.from) throw new v.HttpError(409, 'La tarea cambió de estado. Actualiza el panel antes de continuar.');
      await db.execute('UPDATE tareas SET estado = ?, fecha_completada = COALESCE(?, fecha_completada) WHERE id = ?', [state, state === 'Completada' ? v.today() : null, taskId]);
    });
    res.json({ success: true, mensaje: 'Estado actualizado.' });
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
      } else {
        await db.execute("UPDATE tareas SET estado = 'En_Trabajo', nota_rechazo = ?, fecha_rechazo = UTC_TIMESTAMP(), veces_rechazada = COALESCE(veces_rechazada, 0) + 1 WHERE id = ?", [note, taskId]);
      }
    });
    res.json({ success: true, mensaje: decision === 'aprobar' ? 'Tarea aprobada.' : 'Tarea rechazada y devuelta al mecánico.' });
  });
  router.post('/tareas/verificar-vencidas', auth.allow('mecanico', 'encargado', 'admin'), async (req, res) => {
    const day = v.today();
    const scope = req.usuario.rol === 'mecanico' ? ' AND EXISTS (SELECT 1 FROM tarea_mecanicos tm WHERE tm.id_tarea = tareas.id AND tm.id_mecanico = ?)' : '';
    // Cada vencimiento aplaza un día más; al mover la fecha a mañana, repetir la verificación hoy no vuelve a contar.
    const [result] = await pool.execute(`UPDATE tareas SET fecha_limite = ?, vencida = TRUE, veces_aplazada = COALESCE(veces_aplazada, 0) + 1 WHERE fecha_limite < ? AND estado NOT IN ('Completada', 'Aprobada')${scope}`, [v.tomorrow(day), day, ...(scope ? [req.usuario.id] : [])]);
    res.json({ success: true, tareas_pospuestas: result.affectedRows });
  });
  router.put('/tareas/motivo-aplazamiento/:id', auth.allow('mecanico', 'encargado', 'admin'), async (req, res) => {
    const taskId = v.id(req.params.id), reason = v.text(req.body.motivo, 'Motivo', 10000);
    await transaction(pool, async db => {
      const task = await auth.taskAccess(db, req.usuario, taskId, true);
      if (!task.vencida) throw new v.HttpError(409, 'La tarea no está aplazada.');
      await db.execute('UPDATE tareas SET motivo_aplazamiento = ? WHERE id = ?', [reason, taskId]);
    });
    res.json({ success: true, mensaje: 'Motivo guardado.' });
  });
  router.delete('/tareas/eliminar/:id', auth.allow('admin'), async (req, res) => {
    const taskId = v.id(req.params.id);
    await transaction(pool, async db => {
      await auth.taskAccess(db, req.usuario, taskId, true);
      const [linked] = await db.execute('SELECT id FROM gastos WHERE id_tarea = ? UNION ALL SELECT id FROM evidencia WHERE id_tarea = ? LIMIT 1', [taskId, taskId]);
      if (linked.length) throw new v.HttpError(409, 'La tarea tiene gastos o evidencias; se conserva para mantener su historial.');
      await db.execute('DELETE FROM tarea_mecanicos WHERE id_tarea = ?', [taskId]);
      await db.execute('DELETE FROM tareas WHERE id = ?', [taskId]);
    });
    res.json({ success: true, mensaje: 'Tarea eliminada.' });
  });
  router.get('/gastos/:id_tarea', async (req, res) => {
    const taskId = v.id(req.params.id_tarea);
    await auth.taskAccess(pool, req.usuario, taskId);
    const [gastos] = await pool.execute('SELECT id, id_tarea, concepto, monto, tipo, fecha FROM gastos WHERE id_tarea = ? ORDER BY id', [taskId]);
    
    res.json({ success: true, gastos });
  });
  router.post('/gastos/agregar', auth.allow('mecanico', 'admin'), async (req, res) => {
    const taskId = v.id(req.body.id_tarea), concepto = v.text(req.body.concepto, 'Concepto', 200);
    await transaction(pool, async db => {
      const task = await auth.taskAccess(db, req.usuario, taskId, true);
      if (task.estado !== 'En_Trabajo') throw new v.HttpError(409, 'Solo se pueden registrar gastos en tareas en trabajo.');
      await db.execute('INSERT INTO gastos (id_tarea, concepto, monto, tipo, fecha) VALUES (?, ?, NULL, ?, ?)', [taskId, concepto, 'mecanico', v.today()]);
   });
    res.status(201).json({ success: true, mensaje: 'Gasto registrado.' });
  });
  // El encargado corrige lo que la IA no leyó bien: agrega, ajusta o quita montos de facturas.
  const expenseEditor = auth.allow('encargado', 'admin');
  router.post('/gastos/manual', expenseEditor, async (req, res) => {
    const taskId = v.id(req.body.id_tarea), concepto = v.text(req.body.concepto, 'Concepto', 200), monto = v.amount(req.body.monto);
    const fecha = req.body.fecha ? v.date(req.body.fecha) : v.today();
    if (fecha > v.today()) throw new v.HttpError(400, 'La fecha del gasto no puede ser futura.');
    await auth.taskAccess(pool, req.usuario, taskId);
    await pool.execute("INSERT INTO gastos (id_tarea, concepto, monto, tipo, fecha) VALUES (?, ?, ?, 'factura', ?)", [taskId, concepto, monto, fecha]);
    res.status(201).json({ success: true, mensaje: 'Gasto agregado.' });
  });
  router.put('/gastos/:id', expenseEditor, async (req, res) => {
    const [result] = await pool.execute('UPDATE gastos SET monto = ? WHERE id = ?', [v.amount(req.body.monto), v.id(req.params.id)]);
    v.affected(result);
    res.json({ success: true, mensaje: 'Monto actualizado.' });
  });
  router.delete('/gastos/:id', expenseEditor, async (req, res) => {
    // Solo montos de facturas (p. ej. duplicados); los conceptos del mecánico se conservan.
    const [result] = await pool.execute("DELETE FROM gastos WHERE id = ? AND tipo = 'factura'", [v.id(req.params.id)]);
    v.affected(result);
    res.json({ success: true, mensaje: 'Gasto eliminado.' });
  });
  return router;
};
