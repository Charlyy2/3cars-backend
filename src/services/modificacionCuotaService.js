const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { lockPlan } = require('../helpers/lockHelper');
const {
  EPS,
  roundCurrency,
  composicionCuota,
  deudaEfectivaCuota,
  estadoCuota,
  evaluarObjetivo,
} = require('../helpers/objetivoHelper');

/**
 * MODIFICAR VALOR DE CUOTA
 *
 * Cambia el importe BASE (Installment.monto) de todas las cuotas abiertas del
 * plan y el valor que usarán las cuotas futuras (InstallmentPlan.montoCuotaBase).
 * No es una refinanciación ni una extensión de plazo: no agrega cuotas, no
 * cambia vencimientos, y la diferencia deja de ser exigible.
 *
 * NO mueve dinero ni condona:
 *  - no crea Payment, PaymentAllocation, PlanAjuste ni CashMovement;
 *  - no toca Installment.pagado ni Installment.ajustado;
 *  - los cargos accesorios (sellado, gasto de retiro, mora, otros) se conservan
 *    intactos: total = nuevoMonto + (total - monto).
 *
 * Qué cuotas se modifican:
 *  - PENDIENTE / PARCIAL cuyo importe de cuota todavía no está cubierto
 *    (composicionCuota().cuotaPendiente > 0), aunque estén vencidas.
 *  - PAGADO / REGULARIZADA (y cualquier otro estado) quedan protegidas.
 *  - PARCIAL con la base ya cubierta (solo quedan cargos pendientes): protegida.
 *    Cambiar su base movería, por la cascada cuota → sellado → retiro, dinero
 *    que Caja ya registró en una categoría hacia otra.
 *
 * Validaciones por cuota (si alguna falla, no se modifica NINGUNA):
 *  - el nuevo importe no puede ser inferior a lo ya cubierto (pagado a la base
 *    + ajustado). No se generan devoluciones ni saldos a favor;
 *  - con ajustes previos, el nuevo importe no puede dejar la cuota saldada solo
 *    por esos ajustes (eso es una regularización explícita, no un cambio de valor);
 *  - la imputación del dinero ya cobrado (cuota / sellado / retiro / otros) debe
 *    quedar idéntica: Caja nunca queda inconsistente.
 *
 * Planes CAIDOS: se permite modificar (un cliente suele caer justamente por no
 * poder pagar). La modificación NO cambia el estado del plan: sigue CAIDO hasta
 * una reactivación explícita. Tampoco cambia vencimientos ni borra atrasos.
 *
 * Vista previa versionada: la vista previa devuelve `versionVistaPrevia`, un hash
 * de TODOS los datos que determinan el resultado (plan + cada cuota + importe
 * solicitado). Al confirmar, tras el lock, se recalcula el hash sobre los datos
 * vigentes; si difiere (entró un pago, un ajuste, otra modificación, cambió el
 * estado...), se rechaza con VISTA_PREVIA_DESACTUALIZADA. Así nunca se aplica un
 * resultado distinto del que el operador aceptó.
 */

// Estados del plan en los que tiene sentido comercial cambiar el valor de cuota.
//  - ACTIVO: caso normal.
//  - CAIDO: para intentar recuperar al cliente (el plan NO se reactiva).
// NEGOCIACION / RESUELTO / RETIRADO: la operación ya está en otra etapa.
const ESTADOS_PLAN_MODIFICABLE = ['ACTIVO', 'CAIDO'];
// Estados de cuota candidatos (además se exige base no cubierta).
const ESTADOS_CUOTA_MODIFICABLE = ['PENDIENTE', 'PARCIAL'];

const MONTO_MAXIMO = 1000000000; // tope de cordura (mismo orden que los pagos)

const fmt = (v) => `$${Number(v || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

const motivoProtegida = (c, comp) => {
  switch (c.estado) {
    case 'PAGADO': return 'Cuota pagada: no se modifica su importe ni sus pagos.';
    case 'REGULARIZADA': return 'Cuota regularizada con ajustes: se conserva tal cual.';
    default:
      if (ESTADOS_CUOTA_MODIFICABLE.includes(c.estado) && comp.cuotaPendiente <= EPS) {
        return 'Importe de la cuota ya cubierto (solo quedan cargos accesorios pendientes).';
      }
      return `Cuota en estado ${c.estado}: no se modifica.`;
  }
};

const resumenObjetivo = (o) => ({
  tieneObjetivo: o.tieneObjetivo,
  cuotaObjetivo: o.cuotaObjetivo,
  objetivoOriginal: o.objetivoOriginal,
  pagadoReal: o.pagadoReal,
  ajustesAplicados: o.ajustesAplicados,
  saldoPendienteEfectivo: o.saldoPendienteEfectivo,
  objetivoCumplido: o.objetivoCumplido,
  puedeNegociar: o.puedeNegociar,
});

// JSON canónico (claves ordenadas) para que el hash no dependa del orden de claves.
const canonico = (v) => {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = canonico(v[k]); return o; }, {});
  }
  return v;
};

/**
 * Huella de los datos que determinan el resultado de la modificación. Cualquier
 * pago (pagado/estado), ajuste (ajustado), otra modificación (monto/total/
 * montoCuotaBase), cuota nueva, cambio de cargos, vencimiento o estado del plan
 * la cambia.
 */
const huellaDatos = (plan, installments) => canonico({
  plan: {
    id: plan.id,
    estado: plan.estado,
    montoCuotaBase: Number(plan.montoCuotaBase),
    cuotaObjetivoRetiro: Number(plan.cuotaObjetivoRetiro || 0),
    pagoAbierto: !!plan.pagoAbierto,
    totalCuotas: plan.totalCuotas,
  },
  cuotas: [...installments].sort((a, b) => a.id - b.id).map((c) => ({
    id: c.id,
    numero: c.numero,
    estado: c.estado,
    monto: Number(c.monto),
    total: Number(c.total),
    pagado: Number(c.pagado),
    ajustado: Number(c.ajustado || 0),
    cargosDetalle: c.cargosDetalle || null,
    fechaVencimiento: new Date(c.fechaVencimiento).toISOString(),
  })),
});

const sha256 = (obj) => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');

/** Versión de la vista previa: datos vigentes + importe solicitado. */
const calcularVersion = (plan, installments, nuevoMonto) =>
  sha256({ datos: huellaDatos(plan, installments), nuevoMonto });

const deudaPlan = (installments) =>
  roundCurrency(installments.reduce((s, c) => s + deudaEfectivaCuota(c), 0));

/**
 * Normaliza el nuevo importe. Devuelve null si no vino (vista previa sin monto).
 */
const normalizarMonto = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error('INVALID_MONTO');
  const monto = roundCurrency(n);
  if (!(monto > 0) || monto > MONTO_MAXIMO) throw new Error('INVALID_MONTO');
  return monto;
};

/**
 * Cálculo PURO (no toca la base) de la modificación. Lo usan la vista previa y
 * la operación real (esta última dentro de la transacción, tras el lock).
 *
 * @param {object} plan - InstallmentPlan (estado, montoCuotaBase, cuotaObjetivoRetiro, pagoAbierto)
 * @param {Array} installments - cuotas del plan
 * @param {number|null} nuevoMonto - importe base nuevo (null = solo resumen actual)
 */
const calcularModificacion = (plan, installments = [], nuevoMonto = null) => {
  const cuotas = [...installments].sort((a, b) => a.numero - b.numero);
  const planModificable = ESTADOS_PLAN_MODIFICABLE.includes(plan.estado);

  const filas = [];
  const nuevas = []; // cuotas con los valores resultantes (para objetivo / deuda)

  for (const c of cuotas) {
    const comp = composicionCuota(c);
    const pendienteAnterior = deudaEfectivaCuota(c);
    const base = {
      installmentId: c.id,
      numero: c.numero,
      fechaVencimiento: c.fechaVencimiento,
      estadoAnterior: c.estado,
      montoAnterior: roundCurrency(c.monto),
      totalAnterior: roundCurrency(c.total),
      pagado: roundCurrency(c.pagado),
      ajustado: roundCurrency(c.ajustado || 0),
      pagadoBase: comp.cuotaCobrada,
      cargos: roundCurrency(Number(c.total || 0) - Number(c.monto || 0)),
      pendienteAnterior,
    };

    const abierta = ESTADOS_CUOTA_MODIFICABLE.includes(c.estado) && comp.cuotaPendiente > EPS;
    if (!abierta) {
      filas.push({ ...base, categoria: 'PROTEGIDA', motivo: motivoProtegida(c, comp) });
      nuevas.push(c);
      continue;
    }

    if (nuevoMonto === null) {
      filas.push({ ...base, categoria: 'ABIERTA' });
      nuevas.push(c);
      continue;
    }

    const mora = roundCurrency(c.cargosDetalle?.mora || 0);
    const nuevoImporte = roundCurrency(nuevoMonto + mora);
    const cubierto = roundCurrency(comp.cuotaCobrada + comp.ajustado);

    let incompatible = null;
    if (nuevoImporte < cubierto - EPS) {
      incompatible = comp.ajustado > EPS
        ? `No podés establecer un importe inferior a lo ya cubierto en esta cuota (${fmt(comp.cuotaCobrada)} pagado + ${fmt(comp.ajustado)} ajustado = ${fmt(cubierto)}).`
        : `No podés establecer un importe inferior a lo que el cliente ya pagó en esta cuota (${fmt(comp.cuotaCobrada)}).`;
    } else if (comp.ajustado > EPS && nuevoImporte <= cubierto + EPS) {
      incompatible = `Con ${fmt(nuevoImporte)} la cuota quedaría saldada solo por ajustes previos (${fmt(comp.ajustado)}). Usá "Regularizar saldo objetivo" para condonar.`;
    }

    const nuevoTotal = roundCurrency(nuevoMonto + base.cargos);
    const nueva = { ...c, monto: nuevoMonto, total: nuevoTotal };

    if (!incompatible) {
      // Invariante de Caja: el dinero ya imputado debe seguir en los mismos conceptos.
      const compN = composicionCuota(nueva);
      const keys = ['cuotaCobrada', 'selladoCobrado', 'gastoRetiroCobrado', 'otrosCobrado'];
      if (keys.some((k) => Math.abs(compN[k] - comp[k]) > EPS)) {
        incompatible = 'El cambio alteraría la imputación del dinero ya cobrado (cuota / sellado / gasto de retiro).';
      }
    }

    if (incompatible) {
      filas.push({ ...base, categoria: 'INCOMPATIBLE', motivo: incompatible, montoNuevo: nuevoMonto });
      nuevas.push(c);
      continue;
    }

    if (Math.abs(nuevoMonto - base.montoAnterior) <= EPS) {
      filas.push({ ...base, categoria: 'SIN_CAMBIO', montoNuevo: nuevoMonto, totalNuevo: base.totalAnterior,
        estadoNuevo: c.estado, pendienteNuevo: pendienteAnterior });
      nuevas.push(c);
      continue;
    }

    const estadoNuevo = estadoCuota({ total: nuevoTotal, pagado: c.pagado, ajustado: c.ajustado || 0 });
    nuevas.push({ ...nueva, estado: estadoNuevo });
    filas.push({
      ...base,
      categoria: 'AFECTADA',
      montoNuevo: nuevoMonto,
      totalNuevo: nuevoTotal,
      estadoNuevo,
      pendienteNuevo: deudaEfectivaCuota(nueva),
      variacion: roundCurrency(nuevoTotal - base.totalAnterior),
    });
  }

  const abiertas = filas.filter((f) => f.categoria !== 'PROTEGIDA');
  const montosAbiertos = abiertas.map((f) => f.montoAnterior);
  const valorActual = montosAbiertos.length
    ? { min: Math.min(...montosAbiertos), max: Math.max(...montosAbiertos), uniforme: Math.min(...montosAbiertos) === Math.max(...montosAbiertos) }
    : null;

  const deudaActual = deudaPlan(cuotas);
  const objetivoAntes = evaluarObjetivo(plan, cuotas);

  const out = {
    planId: plan.id,
    estadoPlan: plan.estado,
    planModificable,
    motivoBloqueo: planModificable ? null : `El plan está en estado ${plan.estado}: solo se puede modificar el valor de cuota de un plan ACTIVO o CAÍDO.`,
    // El plan CAIDO sigue CAIDO: la modificación no lo reactiva.
    planCaido: plan.estado === 'CAIDO',
    avisoEstado: plan.estado === 'CAIDO'
      ? 'Se modificarán las cuotas pendientes, pero el plan continuará en estado CAÍDO.'
      : null,
    versionDatos: sha256(huellaDatos(plan, cuotas)),
    pagoAbierto: !!plan.pagoAbierto,
    montoCuotaBasePlan: roundCurrency(plan.montoCuotaBase),
    valorActual,
    cuotasAbiertas: abiertas.length,
    deudaActual,
    cuotas: filas,
    objetivo: { antes: resumenObjetivo(objetivoAntes) },
  };

  if (nuevoMonto === null) return out;

  const afectadas = filas.filter((f) => f.categoria === 'AFECTADA');
  const incompatibles = filas.filter((f) => f.categoria === 'INCOMPATIBLE');
  const deudaNueva = deudaPlan(nuevas);
  const objetivoDespues = evaluarObjetivo(plan, nuevas);

  let efectoNegociacion = null;
  if (!objetivoAntes.puedeNegociar && objetivoDespues.puedeNegociar) efectoNegociacion = 'HABILITA';
  if (objetivoAntes.puedeNegociar && !objetivoDespues.puedeNegociar) efectoNegociacion = 'DESHABILITA';

  const cambiaValorPlan = Math.abs(nuevoMonto - out.montoCuotaBasePlan) > EPS;

  let bloqueo = out.motivoBloqueo;
  if (!bloqueo && incompatibles.length) bloqueo = 'Hay cuotas que no admiten el nuevo importe.';
  if (!bloqueo && afectadas.length === 0 && !(plan.pagoAbierto && cambiaValorPlan)) {
    bloqueo = cambiaValorPlan || abiertas.length === 0
      ? 'No hay cuotas abiertas para modificar.'
      : 'Las cuotas abiertas ya tienen ese importe.';
  }

  return {
    ...out,
    nuevoMonto,
    cambiaValorPlan,
    cuotasAfectadas: afectadas.length,
    incompatibles: incompatibles.map((f) => ({ numero: f.numero, motivo: f.motivo })),
    deudaNueva,
    variacionDeuda: roundCurrency(deudaNueva - deudaActual),
    objetivo: {
      antes: resumenObjetivo(objetivoAntes),
      despues: resumenObjetivo(objetivoDespues),
      efectoNegociacion,
    },
    puedeConfirmar: !bloqueo,
    motivoBloqueo: bloqueo,
    // Se devuelve al confirmar; el backend lo verifica tras el lock.
    versionVistaPrevia: calcularVersion(plan, cuotas, nuevoMonto),
  };
};

const getPlanConCuotas = (db, planId) =>
  db.installmentPlan.findUnique({
    where: { id: parseInt(planId) },
    include: { installments: { orderBy: { numero: 'asc' } } },
  });

/**
 * Vista previa (solo lectura). Sin nuevoMonto devuelve el resumen actual.
 */
const previsualizar = async (planId, nuevoMontoRaw) => {
  const nuevoMonto = normalizarMonto(nuevoMontoRaw);
  let plan = await getPlanConCuotas(prisma, planId);
  if (!plan) throw new Error('PLAN_NOT_FOUND');
  // Pago abierto: materializar (como ya hace la consulta del plan) las cuotas
  // mensuales devengadas, con lock, para que la vista previa y la confirmación
  // vean exactamente las mismas cuotas.
  if (plan.pagoAbierto && plan.estado === 'ACTIVO') {
    plan = await prisma.$transaction(async (tx) => {
      await lockPlan(tx, plan.id);
      const { materializeOpenInstallments } = require('./planService');
      await materializeOpenInstallments(plan.id, tx);
      return getPlanConCuotas(tx, plan.id);
    });
  }
  return calcularModificacion(plan, plan.installments, nuevoMonto);
};

const rechazar = (code, calc) => {
  const err = new Error(code);
  err.preview = calc;
  return err;
};

/**
 * Aplica la modificación. Todo o nada, serializado con pagos / ajustes /
 * negociación mediante el lock del plan (SELECT ... FOR UPDATE).
 *
 * @param {number} planId
 * @param {object} data - { nuevoMonto, motivo, aceptaCambioNegociacion, user: { id, username } }
 */
const modificarCuotas = async (planId, { nuevoMonto: rawMonto, motivo, aceptaCambioNegociacion, versionVistaPrevia, user } = {}) => {
  const parsedPlanId = parseInt(planId);
  const nuevoMonto = normalizarMonto(rawMonto);
  if (nuevoMonto === null) throw new Error('INVALID_MONTO');
  const motivoNorm = String(motivo || '').trim();
  if (!motivoNorm) throw new Error('MOTIVO_REQUERIDO');
  // Sin la versión de la vista previa no hay forma de garantizar que se aplica
  // exactamente lo que el operador vio: es obligatoria.
  const version = String(versionVistaPrevia || '').trim();
  if (!/^[0-9a-f]{64}$/.test(version)) throw new Error('VERSION_REQUERIDA');

  return prisma.$transaction(async (tx) => {
    // 1) Lock ANTES de leer: un pago/ajuste concurrente espera o ya está confirmado.
    await lockPlan(tx, parsedPlanId);

    const plan = await getPlanConCuotas(tx, parsedPlanId);
    if (!plan) throw new Error('PLAN_NOT_FOUND');
    if (!ESTADOS_PLAN_MODIFICABLE.includes(plan.estado)) throw new Error('PLAN_NO_MODIFICABLE');

    // 2) Recalcular TODO sobre los datos leídos tras el lock (nunca desde el front)
    //    y verificar que son los mismos que produjeron la vista previa aceptada.
    const calc = calcularModificacion(plan, plan.installments, nuevoMonto);
    if (calc.versionVistaPrevia !== version) throw rechazar('VISTA_PREVIA_DESACTUALIZADA', calc);

    // 3) Pago abierto: si desde la vista previa se devengó una cuota mensual nueva
    //    (cambio de mes), el resultado ya no sería el aceptado → rechazar. La
    //    vista previa siguiente la materializa y la muestra.
    if (plan.pagoAbierto && plan.estado === 'ACTIVO') {
      const { materializeOpenInstallments } = require('./planService');
      const r = await materializeOpenInstallments(parsedPlanId, tx);
      if (r.added > 0) throw new Error('VISTA_PREVIA_DESACTUALIZADA');
    }

    if (calc.incompatibles.length) throw rechazar('CUOTAS_INCOMPATIBLES', calc);
    if (!calc.puedeConfirmar) {
      throw rechazar(calc.cuotasAbiertas === 0 ? 'SIN_CUOTAS_MODIFICABLES' : 'SIN_CAMBIOS', calc);
    }
    if (calc.objetivo.efectoNegociacion && aceptaCambioNegociacion !== true) {
      throw rechazar('CONFIRMACION_NEGOCIACION_REQUERIDA', calc);
    }

    // 4) Actualizar cada cuota afectada. El WHERE repite los valores leídos:
    //    defensa extra (además del lock) contra cualquier escritura no serializada.
    const afectadas = calc.cuotas.filter((f) => f.categoria === 'AFECTADA');
    const leidas = new Map(plan.installments.map((c) => [c.id, c]));
    for (const f of afectadas) {
      const raw = leidas.get(f.installmentId);
      const res = await tx.installment.updateMany({
        where: {
          id: f.installmentId,
          planId: parsedPlanId,
          estado: raw.estado,
          monto: raw.monto,
          pagado: raw.pagado,
          ajustado: raw.ajustado,
        },
        data: { monto: f.montoNuevo, total: f.totalNuevo, estado: f.estadoNuevo },
      });
      if (res.count !== 1) throw new Error('CONCURRENT_MODIFICATION');
    }

    // 5) Valor para cuotas futuras (pago abierto) = nuevo importe. El ESTADO del
    //    plan no se toca: un plan CAIDO sigue CAIDO (sin reactivación implícita).
    await tx.installmentPlan.update({
      where: { id: parsedPlanId },
      data: { montoCuotaBase: nuevoMonto },
    });

    // 6) Historial (inmutable). Si falla, se revierte todo lo anterior.
    const modificacion = await tx.planModificacionCuota.create({
      data: {
        planId: parsedPlanId,
        clientId: plan.clientId,
        montoAnteriorPlan: calc.montoCuotaBasePlan,
        montoNuevo: nuevoMonto,
        cuotasAfectadas: afectadas.length,
        deudaAnterior: calc.deudaActual,
        deudaNueva: calc.deudaNueva,
        variacionDeuda: calc.variacionDeuda,
        motivo: motivoNorm,
        detalle: afectadas.map((f) => ({
          installmentId: f.installmentId,
          numero: f.numero,
          estadoAnterior: f.estadoAnterior,
          estadoNuevo: f.estadoNuevo,
          montoAnterior: f.montoAnterior,
          montoNuevo: f.montoNuevo,
          totalAnterior: f.totalAnterior,
          totalNuevo: f.totalNuevo,
          pagado: f.pagado,
          ajustado: f.ajustado,
          pendienteAnterior: f.pendienteAnterior,
          pendienteNuevo: f.pendienteNuevo,
        })),
        objetivo: calc.objetivo,
        versionVistaPrevia: version,
        createdById: user?.id || null,
        createdBy: user?.username || null,
      },
    });

    // 7) Resumen actualizado (releído de la base dentro de la transacción).
    const actualizado = await getPlanConCuotas(tx, parsedPlanId);
    return {
      modificacion,
      resumen: calc,
      objetivo: evaluarObjetivo(actualizado, actualizado.installments),
      deudaPendiente: deudaPlan(actualizado.installments),
    };
  });
};

module.exports = {
  ESTADOS_PLAN_MODIFICABLE,
  calcularVersion,
  huellaDatos,
  sha256,
  calcularModificacion,
  previsualizar,
  modificarCuotas,
};
