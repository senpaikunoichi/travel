CREATE TABLE IF NOT EXISTS camion_km_diario (
  patente VARCHAR(10) NOT NULL,
  fecha DATE NOT NULL,
  km DECIMAL(8,1) NOT NULL DEFAULT 0,
  rutas INT NOT NULL DEFAULT 0,
  PRIMARY KEY (patente, fecha),
  KEY idx_km_diario_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
