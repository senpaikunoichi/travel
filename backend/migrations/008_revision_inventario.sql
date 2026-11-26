CREATE TABLE IF NOT EXISTS inventario_revision (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATE NOT NULL,
  id_repuesto INT NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  unidad VARCHAR(20) NULL,
  esperado DECIMAL(12,2) NOT NULL,
  contado DECIMAL(12,2) NOT NULL,
  nota VARCHAR(1000) NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  aclarado BOOLEAN NOT NULL DEFAULT FALSE,
  aclaracion VARCHAR(1000) NULL,
  aclarado_por INT NULL,
  aclarado_at DATETIME NULL,
  UNIQUE KEY uq_revision_dia (fecha, id_repuesto),
  KEY idx_revision_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
