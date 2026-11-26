CREATE TABLE IF NOT EXISTS tarea_eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NOT NULL,
  id_usuario INT NULL,
  tipo VARCHAR(40) NOT NULL,
  detalle VARCHAR(1000) NOT NULL,
  monto DECIMAL(12,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_tarea_eventos_tarea (id_tarea, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
