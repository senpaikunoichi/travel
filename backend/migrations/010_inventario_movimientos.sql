CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_repuesto INT NULL,
  repuesto VARCHAR(120) NOT NULL,
  tipo ENUM('entrada','salida','ajuste') NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  stock_despues DECIMAL(10,2) NOT NULL,
  motivo VARCHAR(300) NOT NULL,
  id_tarea INT NULL,
  id_cotizacion INT NULL,
  patente VARCHAR(10) NULL,
  id_usuario INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mov_fecha (created_at),
  KEY idx_mov_repuesto (id_repuesto, created_at),
  CONSTRAINT fk_mov_repuesto FOREIGN KEY (id_repuesto) REFERENCES repuestos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
