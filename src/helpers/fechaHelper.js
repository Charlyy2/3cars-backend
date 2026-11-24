/**
 * Payment.fecha es una FECHA CALENDARIO (el día del pago que elige el operador),
 * no un instante. Desde siempre se guarda como `new Date('YYYY-MM-DD')`, es decir
 * la MEDIANOCHE UTC de ese día. Esta convención no cambia (no se tocan datos
 * históricos); lo que se corrige es cómo se compara y agrupa:
 *
 *  - el día calendario de un pago = su fecha en UTC;
 *  - los filtros por día / mes usan límites UTC de ese día calendario;
 *  - "hoy" / "este mes" = el día calendario del reloj del servidor (zona del
 *    servidor, como ya hacía el sistema; no se agrega ninguna zona nueva).
 *
 * Antes se mezclaban límites en hora local del servidor con fechas guardadas a
 * medianoche UTC: con el servidor en UTC-3 un pago del día 24 caía en el 23.
 */

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

const utc = (y, m0, d) => new Date(Date.UTC(y, m0, d));

/** Día calendario de hoy según el reloj del servidor → { y, m0, d }. */
const hoyCalendario = (ahora = new Date()) => ({ y: ahora.getFullYear(), m0: ahora.getMonth(), d: ahora.getDate() });

/**
 * Fecha a guardar en Payment.fecha.
 *  - 'YYYY-MM-DD'  → medianoche UTC de ese día (idéntico a lo que se guardaba);
 *  - sin fecha     → medianoche UTC del día calendario de hoy (antes: el instante
 *                    actual, que de noche podía caer en el día siguiente en UTC);
 *  - otro formato  → se respeta como timestamp (compatibilidad).
 */
const fechaPago = (input, ahora = new Date()) => {
  if (input === undefined || input === null || input === '') {
    const h = hoyCalendario(ahora);
    return utc(h.y, h.m0, h.d);
  }
  const m = RE_FECHA.exec(String(input).trim());
  if (m) return utc(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error('FECHA_INVALIDA');
  return d;
};

/** Rango [gte, lt) de un día calendario 'YYYY-MM-DD'. */
const rangoDia = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return { gte: utc(y, (m || 1) - 1, d || 1), lt: utc(y, (m || 1) - 1, (d || 1) + 1) };
};

/** Rango [gte, lt) del día calendario de hoy. */
const rangoHoy = (ahora = new Date()) => {
  const h = hoyCalendario(ahora);
  return { gte: utc(h.y, h.m0, h.d), lt: utc(h.y, h.m0, h.d + 1) };
};

/** Rango [gte, lt) del mes calendario actual. */
const rangoMesActual = (ahora = new Date()) => {
  const h = hoyCalendario(ahora);
  return { gte: utc(h.y, h.m0, 1), lt: utc(h.y, h.m0 + 1, 1) };
};

module.exports = { fechaPago, rangoDia, rangoHoy, rangoMesActual, hoyCalendario };
