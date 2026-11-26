// Versión de los datos: sube con cada cambio guardado. Las pantallas abiertas la consultan y recargan si cambió.
// ponytail: en memoria de un solo proceso (el servicio corre uno); con varios procesos habría que guardarla en la base.
let version = Date.now();
module.exports = { bump: () => { version += 1; }, current: () => version };
