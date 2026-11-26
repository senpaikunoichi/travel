const { Router } = require('express');
const v = require('../validation');
const { transaction } = require('../db');
const { hashPassword, validatePassword } = require('../passwords');

module.exports = function catalog(pool, auth) {
  const router = Router();
  const admin = auth.allow('admin');
  router.get('/mecanicos', auth.allow('admin', 'encargado'), async (req, res) => {
    const [mecanicos] = await pool.execute("SELECT id, nombre FROM usuarios WHERE rol = 'mecanico' ORDER BY nombre");
    res.json({ success: true, mecanicos });
  });
  router.get('/camiones', auth.allow('admin', 'encargado', 'jefe'), async (req, res) => {
    const [camiones] = await pool.execute('SELECT patente, numero, modelo, estado_operativo, km_actual FROM camiones ORDER BY patente');
    res.json({ success: true, camiones });
  });
  router.get('/camiones/:patente/ficha', auth.allow('admin', 'encargado', 'jefe'), async (req, res) => {
    const patente = v.text(req.params.patente, 'Patente', 10).toUpperCase();
    const [[camion]] = await pool.execute(
      'SELECT patente, numero, modelo, estado_operativo FROM camiones WHERE patente = ?',
      [patente],
    );
    if (!camion) throw new v.HttpError(404, 'Camión no encontrado.');
    const [taskResult, expenseResult, evidenceResult] = await Promise.all([
      pool.execute(`SELECT t.id, t.tipo_tarea, t.descripcion, t.fecha_creacion, t.fecha_limite, t.fecha_completada,
          t.estado, t.prioridad, t.vencida, t.veces_aplazada,
          m.mecanicos, COALESCE(g.total_gasto, 0) AS total_gasto
        FROM tareas t
        LEFT JOIN (SELECT tm.id_tarea, GROUP_CONCAT(u.nombre ORDER BY u.nombre SEPARATOR ', ') AS mecanicos
          FROM tarea_mecanicos tm JOIN usuarios u ON u.id = tm.id_mecanico GROUP BY tm.id_tarea) m ON m.id_tarea = t.id
        LEFT JOIN (SELECT id_tarea, SUM(COALESCE(monto, 0)) AS total_gasto FROM gastos GROUP BY id_tarea) g ON g.id_tarea = t.id
        WHERE t.patente_camion = ? ORDER BY t.fecha_creacion DESC, t.id DESC`, [patente]),
      pool.execute(`SELECT g.id, g.id_tarea, g.concepto, g.monto, g.fecha, g.tipo
        FROM gastos g JOIN tareas t ON t.id = g.id_tarea
        WHERE t.patente_camion = ? ORDER BY g.fecha DESC, g.id DESC`, [patente]),
      pool.execute(`SELECT e.id, e.id_tarea, e.ruta_archivo, e.tipo, e.fecha
        FROM evidencia e JOIN tareas t ON t.id = e.id_tarea
        WHERE t.patente_camion = ? ORDER BY e.fecha DESC, e.id DESC`, [patente]),
    ]);
    const tareas = taskResult[0], gastos = expenseResult[0], evidencias = evidenceResult[0];
    const taskById = new Map(tareas.map(task => [task.id, { ...task, gastos: [], evidencias: [] }]));
    for (const expense of gastos) taskById.get(expense.id_tarea)?.gastos.push(expense);
    for (const evidence of evidencias) taskById.get(evidence.id_tarea)?.evidencias.push(evidence);
    res.json({
      success: true,
      camion,
      resumen: {
        tareas: tareas.length,
        completadas: tareas.filter(task => ['Completada', 'Aprobada'].includes(task.estado)).length,
        total_gastos: tareas.reduce((total, task) => total + Number(task.total_gasto || 0), 0),
      },
      tareas: [...taskById.values()],
    });
  });
  router.post('/camiones/agregar', admin, async (req, res) => {
    const patente = v.text(req.body.patente, 'Patente', 10).toUpperCase();
    await pool.execute('INSERT INTO camiones (patente, numero, modelo) VALUES (?, ?, ?)', [patente, v.text(req.body.numero, 'Número', 10), v.text(req.body.modelo, 'Modelo', 50)]);
    res.status(201).json({ success: true, mensaje: 'Camión agregado.' });
  });
  router.put('/camiones/editar/:patente', admin, async (req, res) => {
    const [result] = await pool.execute('UPDATE camiones SET numero = ?, modelo = ? WHERE patente = ?', [v.text(req.body.numero, 'Número', 10), v.text(req.body.modelo, 'Modelo', 50), v.text(req.params.patente, 'Patente', 10)]);
    v.affected(result);
    res.json({ success: true, mensaje: 'Camión actualizado.' });
  });
  router.put('/camiones/estado/:patente', auth.allow('admin', 'encargado', 'jefe'), async (req, res) => {
    const patente = v.text(req.params.patente, 'Patente', 10).toUpperCase();
    const estado = req.body.estado_operativo;
    if (!['activo', 'panne'].includes(estado)) throw new v.HttpError(400, 'Estado operativo inválido.');
    const [result] = await pool.execute('UPDATE camiones SET estado_operativo = ? WHERE patente = ?', [estado, patente]);
    v.affected(result, 'Camión no encontrado.');
    res.json({ success: true, mensaje: estado === 'panne' ? 'Camión marcado en panne.' : 'Camión marcado como activo.' });
  });
  router.delete('/camiones/eliminar/:patente', admin, async (req, res) => {
    const patente = v.text(req.params.patente, 'Patente', 10);
    await transaction(pool, async db => {
      const [truck] = await db.execute('SELECT patente FROM camiones WHERE patente = ? FOR UPDATE', [patente]);
      if (!truck.length) throw new v.HttpError(404, 'Camión no encontrado.');
      const [tasks] = await db.execute('SELECT id FROM tareas WHERE patente_camion = ? LIMIT 1', [patente]);
      if (tasks.length) throw new v.HttpError(409, 'El camión tiene tareas asociadas y no se puede eliminar.');
      const [inspections] = await db.execute('SELECT id FROM inspecciones_camion WHERE patente_camion = ? LIMIT 1', [patente]);
      if (inspections.length) throw new v.HttpError(409, 'El camión tiene inspecciones asociadas y no se puede eliminar.');
      await db.execute('DELETE FROM camiones WHERE patente = ?', [patente]);
    });
    res.json({ success: true, mensaje: 'Camión eliminado.' });
  });
  router.get('/usuarios', admin, async (req, res) => {
    const [usuarios] = await pool.execute('SELECT id, nombre, email, rol, created_at FROM usuarios ORDER BY nombre');
    res.json({ success: true, usuarios });
  });
  router.post('/usuarios/agregar', admin, async (req, res) => {
    const nombre = v.text(req.body.nombre, 'Nombre', 100), email = v.email(req.body.email), rol = v.role(req.body.rol);
    const password = await hashPassword(validatePassword(req.body.password, true));
    await pool.execute('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)', [nombre, email, password, rol]);
    res.status(201).json({ success: true, mensaje: 'Usuario agregado.' });
  });
  router.put('/usuarios/editar/:id', admin, async (req, res) => {
    const userId = v.id(req.params.id), nombre = v.text(req.body.nombre, 'Nombre', 100), email = v.email(req.body.email), rol = v.role(req.body.rol);
    if (userId === req.usuario.id && rol !== 'admin') throw new v.HttpError(409, 'No puedes quitarte tu propio rol de administrador.');
    // Contraseña opcional: vacía conserva la actual; una nueva cierra las demás sesiones del usuario.
    const password = req.body.password ? await hashPassword(validatePassword(req.body.password, true)) : null;
    await transaction(pool, async db => {
      const [users] = await db.execute('SELECT id, rol FROM usuarios WHERE id = ? FOR UPDATE', [userId]);
      if (!users.length) throw new v.HttpError(404, 'Usuario no encontrado.');
      if (users[0].rol === 'mecanico' && rol !== 'mecanico') {
        const [assigned] = await db.execute("SELECT tm.id FROM tarea_mecanicos tm JOIN tareas t ON t.id = tm.id_tarea WHERE tm.id_mecanico = ? AND t.estado IN ('Pendiente', 'En_Trabajo') LIMIT 1", [userId]);
        if (assigned.length) throw new v.HttpError(409, 'El mecánico tiene tareas activas; finalízalas antes de cambiar su rol.');
      }
      await db.execute('UPDATE usuarios SET nombre = ?, email = ?, rol = ? WHERE id = ?', [nombre, email, rol, userId]);
      if (password) await db.execute('UPDATE usuarios SET password = ? WHERE id = ?', [password, userId]);
      if (users[0].rol !== rol || password) await db.execute('DELETE FROM app_sessions WHERE user_id = ? AND token_hash <> ?', [userId, req.sessionHash]);
    });
    res.json({ success: true, mensaje: password ? 'Usuario actualizado y contraseña restablecida.' : 'Usuario actualizado.' });
  });
  router.delete('/usuarios/eliminar/:id', admin, async (req, res) => {
    const userId = v.id(req.params.id);
    if (userId === req.usuario.id) throw new v.HttpError(409, 'No puedes eliminar tu propia cuenta.');
    await transaction(pool, async db => {
      const [users] = await db.execute('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [userId]);
      if (!users.length) throw new v.HttpError(404, 'Usuario no encontrado.');
      const [linked] = await db.execute('SELECT id FROM tareas WHERE created_by = ? UNION ALL SELECT id FROM tarea_mecanicos WHERE id_mecanico = ? LIMIT 1', [userId, userId]);
      if (linked.length) throw new v.HttpError(409, 'El usuario tiene tareas asociadas y no se puede eliminar.');
      await db.execute('DELETE FROM app_sessions WHERE user_id = ?', [userId]);
      await db.execute('DELETE FROM usuarios WHERE id = ?', [userId]);
    });
    res.json({ success: true, mensaje: 'Usuario eliminado.' });
  });
  return router;
};
