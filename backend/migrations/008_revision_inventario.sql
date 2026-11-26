CREATE TABLE IF NOT EXISTS inventario_revision (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_repuesto INT NOT NULL,
  id_usuario INT NOT NULL,
  fecha DATE NOT NULL,
  contado INT NOT NULL,
  nota VARCHAR(1000) NULL,
  aclaracion VARCHAR(1000) NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_inventario_revision_repuesto_fecha (id_repuesto, fecha),
  INDEX idx_inventario_revision_fecha (fecha),
  CONSTRAINT fk_inventario_revision_repuesto FOREIGN KEY (id_repuesto) REFERENCES repuestos(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventario_revision_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
