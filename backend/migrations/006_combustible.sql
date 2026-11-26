CREATE TABLE IF NOT EXISTS combustible_registros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patente VARCHAR(10) NOT NULL,
  fecha DATE NOT NULL,
  ruta VARCHAR(150) NOT NULL,
  nivel TINYINT UNSIGNED NOT NULL,
  litros DECIMAL(7,1) NULL,
  nota VARCHAR(1000) NOT NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_combustible_fecha (fecha),
  KEY idx_combustible_patente (patente, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
