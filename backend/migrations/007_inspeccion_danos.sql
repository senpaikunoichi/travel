CREATE TABLE IF NOT EXISTS inspeccion_danos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_inspeccion INT NOT NULL,
  vista ENUM('frente','posterior','izquierdo','derecho') NOT NULL,
  x DECIMAL(5,2) NOT NULL,
  y DECIMAL(5,2) NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  nota VARCHAR(300) NULL,
  ruta_archivo VARCHAR(500) NULL,
  KEY idx_inspeccion_danos (id_inspeccion),
  CONSTRAINT fk_inspeccion_dano FOREIGN KEY (id_inspeccion) REFERENCES inspecciones_camion(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
