// Todo cambio de stock pasa por aquí: actualiza el repuesto y deja el movimiento (entrada, salida o ajuste) con su motivo.
// cantidad con signo: positiva entra, negativa sale. Devuelve el stock que queda.
async function move(db, { id_repuesto, cantidad, motivo, tipo = cantidad >= 0 ? 'entrada' : 'salida', id_tarea = null, id_cotizacion = null, patente = null, usuario = null }) {
  const n = Number(cantidad);
  if (!n) return null;
  await db.execute('UPDATE repuestos SET stock = stock + ? WHERE id = ?', [n, id_repuesto]);
  const [[part]] = await db.execute('SELECT nombre, stock FROM repuestos WHERE id = ?', [id_repuesto]);
  await db.execute(`INSERT INTO inventario_movimientos (id_repuesto, repuesto, tipo, cantidad, stock_despues, motivo, id_tarea, id_cotizacion, patente, id_usuario, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`, [id_repuesto, part.nombre, tipo, n, part.stock, String(motivo).slice(0, 300), id_tarea, id_cotizacion, patente, usuario?.id ?? null]);
  return Number(part.stock);
}
// Edición directa del stock (Excel o formulario): se registra la diferencia como ajuste.
const adjust = (db, id_repuesto, before, after, motivo, usuario) => move(db, { id_repuesto, cantidad: Number(after) - Number(before), tipo: 'ajuste', motivo, usuario });
module.exports = { move, adjust };
