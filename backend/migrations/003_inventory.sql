CREATE TABLE IF NOT EXISTS repuestos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo_qr VARCHAR(100) NULL,
  nombre VARCHAR(150) NOT NULL,
  categoria VARCHAR(100) NOT NULL,
  stock_actual INT NOT NULL DEFAULT 0,
  stock_minimo INT NOT NULL DEFAULT 0,
  costo_unitario DECIMAL(12,2) NULL,
  ubicacion VARCHAR(100) NOT NULL,
  foto_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_repuestos_codigo_qr (codigo_qr),
  INDEX idx_repuestos_nombre_categoria (nombre, categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id INT AUTO_INCREMENT PRIMARY KEY,
  repuesto_id INT NOT NULL,
  tipo ENUM('ENTRADA','SALIDA') NOT NULL,
  cantidad INT NOT NULL,
  camion_id VARCHAR(10) NULL,
  usuario_id INT NOT NULL,
  comentario VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_movimientos_repuesto_fecha (repuesto_id, created_at),
  INDEX idx_movimientos_fecha (created_at),
  INDEX idx_movimientos_camion (camion_id),
  CONSTRAINT fk_inv_v3_movimientos_repuesto FOREIGN KEY (repuesto_id) REFERENCES repuestos(id),
  CONSTRAINT fk_inv_v3_movimientos_camion FOREIGN KEY (camion_id) REFERENCES camiones(patente),
  CONSTRAINT fk_inv_v3_movimientos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS solicitudes_compra (
  id INT AUTO_INCREMENT PRIMARY KEY,
  repuesto_id INT NULL,
  descripcion_pieza VARCHAR(500) NOT NULL,
  cantidad INT NOT NULL,
  estado ENUM('PENDIENTE','APROBADO','RECIBIDO') NOT NULL DEFAULT 'PENDIENTE',
  solicitado_por INT NOT NULL,
  foto_comprobante_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_solicitudes_estado_fecha (estado, created_at),
  CONSTRAINT fk_inv_v3_solicitudes_repuesto FOREIGN KEY (repuesto_id) REFERENCES repuestos(id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_v3_solicitudes_usuario FOREIGN KEY (solicitado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
