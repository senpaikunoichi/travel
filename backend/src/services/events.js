// Historial de la OT: quién hizo qué y cuándo. El monto va aparte para ocultárselo al mecánico.
async function logEvent(db, idTarea, user, tipo, detalle, monto = null) {
  await db.execute('INSERT INTO tarea_eventos (id_tarea, id_usuario, tipo, detalle, monto, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())',
    [idTarea, user?.id || null, tipo, String(detalle).slice(0, 1000), monto]);
}

module.exports = { logEvent };
