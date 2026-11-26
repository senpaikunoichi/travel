CREATE TABLE IF NOT EXISTS checklists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NULL,
  patente VARCHAR(10) NOT NULL,
  fecha DATE NOT NULL,
  id_usuario INT NOT NULL,
  km INT NULL,
  items JSON NOT NULL,
  observaciones VARCHAR(2000) NULL,
  fallas INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_checklist_tarea (id_tarea),
  KEY idx_checklist_fecha (fecha),
  KEY idx_checklist_patente (patente, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
