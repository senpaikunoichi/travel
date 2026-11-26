CREATE TABLE IF NOT EXISTS historial_ot (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_tarea INT NOT NULL,
  id_usuario INT NULL,
  tipo VARCHAR(50) NOT NULL,
  detalle VARCHAR(2000) NOT NULL,
  monto DECIMAL(12,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_historial_ot_tarea_fecha (id_tarea, created_at),
  CONSTRAINT fk_historial_ot_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id) ON DELETE CASCADE,
  CONSTRAINT fk_historial_ot_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notificaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rol ENUM('admin','jefe','encargado','mecanico') NOT NULL,
  mensaje VARCHAR(1000) NOT NULL,
  id_tarea INT NULL,
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notificaciones_rol_fecha (rol, created_at),
  INDEX idx_notificaciones_tarea (id_tarea),
  CONSTRAINT fk_notificaciones_tarea FOREIGN KEY (id_tarea) REFERENCES tareas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
