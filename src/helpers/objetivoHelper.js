/**
 * Regla de dominio ÚNICA del objetivo del plan (cuota objetivo) y de la
 * habilitación de NEGOCIACIÓN. Funciones puras: no tocan la base.
 *
 * El "objetivo" son las cuotas 1..cuotaObjetivoRetiro del plan, medido SOLO sobre
 * el importe de la cuota/base (base + mora). Los cargos accesorios (sellado,
 * gasto de retiro, otros) se informan aparte y NO bloquean la negociación:
 *
 *   objetivoOriginal       = Σ importeCuota   (cuotas del objetivo, sin cargos)
 *   pagadoReal             = Σ cuotaCobrada   (dinero que, por la cascada, cubrió la cuota)
 *   ajustesAplicados       = Σ ajustado       (ajustes ACTIVOS: condonaciones / ajustes comerciales)
 *   saldoPendienteReal     = max(0, objetivoOriginal - pagadoReal)
 *   saldoPendienteEfectivo = max(0, objetivoOriginal - pagadoReal - ajustesAplicados)
 *   objetivoCumplido       = saldoPendienteEfectivo <= 0
 *   cargosPendientes       = Σ cargos impagos (informativo: no se cobran, ajustan ni condonan)
 *
 * Regla de negociación (definitiva):
 *   A) Plan SIN cuota objetivo (cuotaObjetivoRetiro <= 0) → puede negociar.
 *   B) Plan CON cuota objetivo → solo si saldoPendienteEfectivo <= 0
 *      (pagos reales a la cuota + ajustes válidos cubren el objetivo), aunque
 *      queden cargos accesorios pendientes. No depende del estado de la cuota:
 *      una cuota puede seguir PARCIAL por cargos y el plan igual negociar.
 *
 * Saldada ≠ cobrada:
 *   - "saldada" (sin deuda): PAGADO o REGULARIZADA → isCuotaSaldada().
 *   - "cobrada" (dinero): SIEMPRE desde `pagado` / composicionCuota(), nunca desde `total`.
 *   - "condonada": desde `ajustado`.
 */

const roundCurrency = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

// Tolerancia de centavos para comparar montos en Float.
const EPS = 0.005;

// Estados de cuota que ya no son deuda exigible.
//  - PAGADO: cubierta 100% con dinero.
//  - REGULARIZADA: cubierta con dinero + ajustes (pagado < total). No es un pago.
const ESTADOS_SALDADOS = ['PAGADO', 'REGULARIZADA'];
const isCuotaSaldada = (estado) => ESTADOS_SALDADOS.includes(estado);

// Estados del plan desde los que se puede negociar (NEGOCIACION = flujo viejo).
const ESTADOS_NEGOCIABLES = ['ACTIVO', 'NEGOCIACION'];

const TIPOS_AJUSTE = ['AJUSTE_COMERCIAL', 'CONDONACION', 'OTRO'];

/**
 * Composición de una cuota según la regla de imputación confirmada:
 * el dinero cubre PRIMERO el importe de la cuota (base + mora) y recién
 * después los cargos, en orden: sellado → gasto de retiro → otros.
 *
 * Un ajuste reduce SOLO el importe de la cuota: nunca condona ni cobra
 * sellado / gasto de retiro. Por eso el dinero que va a la cuota tiene tope
 * (importeCuota - ajustado) y el excedente pasa a los cargos.
 *
 * Todo se deriva de (total, monto, cargosDetalle, pagado, ajustado): no hay
 * columnas extra que mantener.
 */
const composicionCuota = (c) => {
  const detalle = c.cargosDetalle || {};
  const sellado = roundCurrency(detalle.sellado || 0);
  const gastoRetiro = roundCurrency(detalle.gastoRetiro || 0);
  const importeCuota = roundCurrency(Number(c.monto || 0) + Number(detalle.mora || 0));
  const total = roundCurrency(c.total);
  const otros = Math.max(0, roundCurrency(total - importeCuota - sellado - gastoRetiro));
  const ajustado = roundCurrency(c.ajustado || 0);

  let resto = roundCurrency(c.pagado || 0);
  const tomar = (tope) => {
    const v = roundCurrency(Math.min(resto, Math.max(0, tope)));
    resto = roundCurrency(resto - v);
    return v;
  };
  const cuotaCobrada = tomar(importeCuota - ajustado);
  const selladoCobrado = tomar(sellado);
  const gastoRetiroCobrado = tomar(gastoRetiro);
  const otrosCobrado = tomar(otros);

  const cuotaPendiente = Math.max(0, roundCurrency(importeCuota - ajustado - cuotaCobrada));
  const cargosPendientes = Math.max(0, roundCurrency(
    (sellado - selladoCobrado) + (gastoRetiro - gastoRetiroCobrado) + (otros - otrosCobrado)
  ));

  return {
    importeCuota,
    sellado,
    gastoRetiro,
    otros,
    ajustado,
    cuotaCobrada,
    selladoCobrado,
    gastoRetiroCobrado,
    otrosCobrado,
    cuotaPendiente,
    cargosPendientes,
    // Importe de la cuota cubierto (dinero + ajuste), aunque queden cargos.
    cuotaSaldada: cuotaPendiente <= EPS,
  };
};

/**
 * Cuánto se puede ajustar en una cuota: solo lo que falta del IMPORTE de la
 * cuota. Si el dinero ya pasó a los cargos, el importe está cubierto (0).
 */
const ajustableCuota = (c) => composicionCuota(c).cuotaPendiente;

/** Deuda efectiva de una cuota: lo que falta cubrir con dinero o ajustes. */
const deudaEfectivaCuota = (c) =>
  Math.max(0, roundCurrency(Number(c.total || 0) - Number(c.pagado || 0) - Number(c.ajustado || 0)));

/**
 * Estado de una cuota a partir de su composición (pagado / ajustado / total).
 * Nunca marca PAGADO por un ajuste.
 */
const estadoCuota = ({ total, pagado, ajustado }) => {
  const t = roundCurrency(total);
  const p = roundCurrency(pagado);
  const a = roundCurrency(ajustado);
  if (p >= t - EPS) return 'PAGADO';
  if (p + a >= t - EPS) return 'REGULARIZADA';
  return p > 0 ? 'PARCIAL' : 'PENDIENTE';
};

/**
 * Evalúa el objetivo de un plan.
 * @param {object} plan - { estado, cuotaObjetivoRetiro }
 * @param {Array} installments - cuotas del plan ({ numero, total, pagado, ajustado, estado, fechaVencimiento })
 */
const evaluarObjetivo = (plan, installments = []) => {
  const cuotaObjetivo = Number(plan?.cuotaObjetivoRetiro || 0);
  const tieneObjetivo = cuotaObjetivo > 0;
  const cuotas = installments
    .filter((c) => Number(c.numero) <= cuotaObjetivo)
    .sort((a, b) => a.numero - b.numero);

  let objetivoOriginal = 0;
  let pagadoReal = 0;
  let ajustesAplicados = 0;
  let cargosPendientes = 0;
  for (const c of cuotas) {
    const comp = composicionCuota(c);
    objetivoOriginal += comp.importeCuota;
    pagadoReal += comp.cuotaCobrada;
    ajustesAplicados += comp.ajustado;
    cargosPendientes += comp.cargosPendientes;
  }
  objetivoOriginal = roundCurrency(objetivoOriginal);
  pagadoReal = roundCurrency(pagadoReal);
  ajustesAplicados = roundCurrency(ajustesAplicados);
  cargosPendientes = roundCurrency(cargosPendientes);

  const saldoPendienteReal = Math.max(0, roundCurrency(objetivoOriginal - pagadoReal));
  const saldoPendienteEfectivo = Math.max(0, roundCurrency(objetivoOriginal - pagadoReal - ajustesAplicados));
  // Lo único ajustable es el saldo de la cuota/base (los cargos nunca).
  const ajustableMaximo = saldoPendienteEfectivo;

  // Sin objetivo configurado (0) no hay exigencia: se conserva el comportamiento
  // previo del backend. Con objetivo, todas sus cuotas deben existir y su
  // importe de cuota/base estar cubierto (los cargos pendientes no cuentan).
  const objetivoCumplido = !tieneObjetivo
    || (cuotas.length >= cuotaObjetivo && saldoPendienteEfectivo <= EPS);

  const estado = plan?.estado;
  // A) sin objetivo → puede negociar; B) con objetivo → objetivo cumplido.
  const puedeNegociar = ESTADOS_NEGOCIABLES.includes(estado) && objetivoCumplido;

  // Regularizar tiene sentido solo con plan ACTIVO, con saldo por cubrir y cuando
  // la cuota objetivo ya empezó a pagarse o ya venció (no para cualquier cliente).
  const cuotaObj = cuotas.find((c) => Number(c.numero) === cuotaObjetivo);
  const objetivoEnCurso = !!cuotaObj && (
    Number(cuotaObj.pagado || 0) > 0
    || Number(cuotaObj.ajustado || 0) > 0
    || new Date(cuotaObj.fechaVencimiento) <= new Date()
  );
  // Solo se regulariza el importe de las cuotas (no los cargos).
  const puedeRegularizar = estado === 'ACTIVO' && tieneObjetivo && ajustableMaximo > EPS && objetivoEnCurso;

  return {
    cuotaObjetivo,
    tieneObjetivo,
    objetivoOriginal,
    pagadoReal,
    ajustesAplicados,
    saldoPendienteReal,
    saldoPendienteEfectivo,
    ajustableMaximo,
    cargosPendientes,
    objetivoCumplido,
    regularizado: objetivoCumplido && tieneObjetivo && ajustesAplicados > 0,
    puedeNegociar,
    puedeRegularizar,
  };
};

module.exports = {
  EPS,
  ESTADOS_SALDADOS,
  ESTADOS_NEGOCIABLES,
  TIPOS_AJUSTE,
  roundCurrency,
  isCuotaSaldada,
  deudaEfectivaCuota,
  composicionCuota,
  ajustableCuota,
  estadoCuota,
  evaluarObjetivo,
};
