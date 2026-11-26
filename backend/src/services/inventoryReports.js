const v = require('../validation');

function defaultRange() {
  const end = v.today();
  const start = new Date(Date.parse(`${end}T12:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  return [start, end];
}

function parseFilters(query) {
  let dates = defaultRange();
  if (query.fecha_inicio !== undefined || query.fecha_fin !== undefined) {
    if (query.fecha_inicio === undefined || query.fecha_fin === undefined) {
      throw new v.HttpError(400, 'Debes indicar ambas fechas del período.');
    }
    dates = v.dateRange(query);
  }
  const estado = query.estado_stock === undefined ? 'todos' : v.text(query.estado_stock, 'Estado de stock', 20);
  if (!['todos', 'critico_bajo', 'agotado'].includes(estado)) {
    throw new v.HttpError(400, 'Estado de stock inválido.');
  }
  const tipo = query.tipo_movimiento === undefined ? 'todos' : v.text(query.tipo_movimiento, 'Tipo de movimiento', 10);
  if (!['todos', 'ENTRADA', 'SALIDA'].includes(tipo)) {
    throw new v.HttpError(400, 'Tipo de movimiento inválido.');
  }
  return {
    fecha_inicio: dates[0],
    fecha_fin: dates[1],
    categoria: query.categoria ? v.text(query.categoria, 'Categoría', 100) : '',
    estado_stock: estado,
    tipo_movimiento: tipo,
    camion: query.camion ? v.text(query.camion, 'Patente', 10) : '',
  };
}

function stockPredicate(filters, alias = 'r') {
  const where = [];
  const values = [];
  if (filters.categoria) {
    where.push(`${alias}.categoria = ?`);
    values.push(filters.categoria);
  }
  if (filters.estado_stock === 'critico_bajo') {
    where.push(`${alias}.stock_actual <= CEIL(${alias}.stock_minimo * 1.25)`);
  } else if (filters.estado_stock === 'agotado') {
    where.push(`${alias}.stock_actual = 0`);
  }
  return { where, values };
}

function movementPredicate(filters) {
  const { where, values } = stockPredicate(filters);
  where.push('m.created_at >= ?', 'm.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
  values.push(filters.fecha_inicio, filters.fecha_fin);
  if (filters.tipo_movimiento !== 'todos') {
    where.push('m.tipo = ?');
    values.push(filters.tipo_movimiento);
  }
  if (filters.camion) {
    where.push('m.camion_id = ?');
    values.push(filters.camion);
  }
  return { where, values };
}

async function loadInventoryReport(pool, filters) {
  const stockFilter = stockPredicate(filters);
  const movementFilter = movementPredicate(filters);
  const [[stock], [movimientos], [categorias], [camiones]] = await Promise.all([
    pool.execute(
      `SELECT r.id, r.codigo_qr, r.nombre, r.categoria, r.stock_actual, r.stock_minimo,
        r.costo_unitario, r.ubicacion, COALESCE(r.stock_actual * r.costo_unitario, 0) AS valor_estimado
       FROM repuestos r ${stockFilter.where.length ? `WHERE ${stockFilter.where.join(' AND ')}` : ''}
       ORDER BY r.nombre, r.id`,
      stockFilter.values,
    ),
    pool.execute(
      `SELECT m.created_at, m.tipo, r.nombre AS repuesto, r.codigo_qr, m.cantidad,
        m.camion_id AS camion, u.nombre AS usuario, m.comentario
       FROM movimientos_inventario m
       JOIN repuestos r ON r.id = m.repuesto_id
       JOIN usuarios u ON u.id = m.usuario_id
       WHERE ${movementFilter.where.join(' AND ')}
       ORDER BY m.created_at DESC, m.id DESC`,
      movementFilter.values,
    ),
    pool.execute('SELECT DISTINCT categoria FROM repuestos ORDER BY categoria'),
    pool.execute('SELECT patente, numero FROM camiones ORDER BY patente'),
  ]);
  const valorConocido = stock.reduce((total, item) => total + Number(item.valor_estimado || 0), 0);
  const sinCosto = stock.filter(item => item.costo_unitario === null).length;
  const criticos = stock.filter(item => Number(item.stock_actual) <= Number(item.stock_minimo)).length;
  const bajos = stock.filter(item => Number(item.stock_actual) > Number(item.stock_minimo)
    && Number(item.stock_actual) <= Math.ceil(Number(item.stock_minimo) * 1.25)).length;
  return {
    filtros: filters,
    resumen: {
      total_repuestos: stock.length,
      unidades: stock.reduce((total, item) => total + Number(item.stock_actual), 0),
      valor_estimado: valorConocido,
      repuestos_sin_costo: sinCosto,
      criticos,
      bajos,
      agotados: stock.filter(item => Number(item.stock_actual) === 0).length,
      movimientos: movimientos.length,
    },
    repuestos: stock,
    movimientos,
    categorias: categorias.map(row => row.categoria),
    camiones: camiones.map(row => ({ patente: row.patente, numero: row.numero })),
  };
}

module.exports = { defaultRange, parseFilters, loadInventoryReport };
