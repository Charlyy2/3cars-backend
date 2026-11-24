const planService = require('../services/planService');
const ajusteObjetivoService = require('../services/ajusteObjetivoService');
const modificacionCuotaService = require('../services/modificacionCuotaService');
const reactivacionService = require('../services/reactivacionService');

const formatMoney = (v) => `$${Number(v || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

// Errores de validación de una entrega de capital (DINERO | VEHICULO | MIXTA).
const ENTREGA_ERRORS = {
  INVALID_TIPO_ENTREGA: [400, 'Tipo de entrega inválido (DINERO, VEHICULO o MIXTA)'],
  INVALID_AMOUNT: [400, 'El monto en dinero debe ser mayor a 0'],
  NEGATIVE_AMOUNT: [400, 'Los montos no pueden ser negativos'],
  VEHICULO_REQUERIDO: [400, 'Faltan los datos del vehículo entregado'],
  INVALID_VALOR_TOMA: [400, 'El valor de toma del vehículo debe ser mayor a 0'],
  VEHICULO_PATENTE_REQUERIDA: [400, 'La patente del vehículo es obligatoria'],
  VEHICULO_ANIO_INVALIDO: [400, 'El año del vehículo es inválido'],
  VEHICULO_MARCA_REQUERIDA: [400, 'La marca del vehículo es obligatoria'],
  VEHICULO_MODELO_REQUERIDO: [400, 'El modelo del vehículo es obligatorio'],
};

// Mensaje del rechazo de negociación: informa el saldo que falta si se conoce.
const objetivoNoCumplidoMsg = (error, base) =>
  error.objetivo ? `${base}: saldo pendiente ${formatMoney(error.objetivo.saldoPendienteEfectivo)}` : base;

/**
 * Crear plan de pago sin vehículo
 */
const createPlan = async (req, res) => {
  try {
    const {
      clientId,
      numeroSolicitud,
      montoCuotaBase,
      cantidadCuotas,
      fechaInicio,
      selladoMonto,
      cuotasConSellado,
      administrativoPct,
      cuotaObjetivoRetiro,
      retiroPct,
      observaciones,
      primerCuotaPagada
    } = req.body;

    // Validaciones básicas
    if (
      clientId === undefined ||
      montoCuotaBase === undefined ||
      cantidadCuotas === undefined ||
      !fechaInicio
    ) {
      return res.status(400).json({
        error: 'Campos requeridos: clientId, montoCuotaBase, cantidadCuotas, fechaInicio',
      });
    }

    const parsedClientId = Number(clientId);
    const parsedMontoCuotaBase = Number(montoCuotaBase);
    const parsedCantidadCuotas = Number(cantidadCuotas);

    if (
      Number.isNaN(parsedClientId) ||
      Number.isNaN(parsedMontoCuotaBase) ||
      Number.isNaN(parsedCantidadCuotas)
    ) {
      return res.status(400).json({
        error: 'clientId, montoCuotaBase y cantidadCuotas deben ser numéricos',
      });
    }

    if (parsedMontoCuotaBase <= 0 || parsedCantidadCuotas <= 0) {
      return res.status(400).json({
        error: 'montoCuotaBase y cantidadCuotas deben ser mayores a 0',
      });
    }

    const planData = {
      clientId: parsedClientId,
      numeroSolicitud: numeroSolicitud || null,
      montoCuotaBase: parsedMontoCuotaBase,
      cantidadCuotas: parsedCantidadCuotas,
      fechaInicio,
      selladoMonto: selladoMonto !== undefined ? Number(selladoMonto) : 0,
      cuotasConSellado: cuotasConSellado !== undefined ? Number(cuotasConSellado) : 2,
      administrativoPct: administrativoPct !== undefined ? Number(administrativoPct) : 0,
      cuotaObjetivoRetiro: cuotaObjetivoRetiro !== undefined ? Number(cuotaObjetivoRetiro) : 0,
      retiroPct: retiroPct !== undefined ? Number(retiroPct) : 0,
      observaciones: observaciones || null,
      primerCuotaPagada: primerCuotaPagada !== undefined ? Boolean(primerCuotaPagada) : true,
    };

    const result = await planService.createPlan(planData);

    return res.status(201).json(result);
  } catch (error) {
    if (error.message === 'CLIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    if (error.message === 'ACTIVE_PLAN_EXISTS') {
      return res.status(409).json({ error: 'El cliente ya tiene un plan vigente (activo o en negociación)' });
    }

    if (error.message === 'SOLICITUD_EXISTS') {
      return res.status(409).json({ error: 'El número de solicitud ya existe' });
    }

    console.error('Error al crear plan:', error);
    return res.status(500).json({ error: 'Error al crear plan' });
  }
};

/**
 * Retirar vehículo
 */
const retirarVehiculo = async (req, res) => {
  try {
    const { id: planId } = req.params;
    const { vehicleId } = req.body;

    if (!vehicleId) {
      return res.status(400).json({ error: 'vehicleId es requerido' });
    }

    const parsedVehicleId = Number(vehicleId);
    if (Number.isNaN(parsedVehicleId)) {
      return res.status(400).json({ error: 'vehicleId debe ser numérico' });
    }

    const result = await planService.retirarVehiculo(planId, parsedVehicleId);

    return res.status(200).json(result);
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }

    if (error.message === 'PLAN_NOT_ACTIVE') {
      return res.status(400).json({ error: 'El plan no está activo' });
    }

    if (error.message === 'VEHICLE_ALREADY_WITHDRAWN') {
      return res.status(409).json({ error: 'Ya se retiró un vehículo para este plan' });
    }

    if (error.message === 'VEHICLE_NOT_FOUND') {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    if (error.message === 'VEHICLE_NOT_AVAILABLE') {
      return res.status(409).json({ error: 'El vehículo no está disponible' });
    }

    if (error.message === 'INSUFFICIENT_INSTALLMENTS_PAID') {
      return res.status(400).json({ error: 'No se alcanzó la cuota objetivo para retiro' });
    }

    console.error('Error al retirar vehículo:', error);
    return res.status(500).json({ error: 'Error al retirar vehículo' });
  }
};

/**
 * Obtener plan por ID
 */
const getPlanById = async (req, res) => {
  try {
    const { id } = req.params;

    const plan = await planService.getPlanById(id);

    return res.status(200).json(plan);
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }

    console.error('Error al obtener plan:', error);
    return res.status(500).json({ error: 'Error al obtener plan' });
  }
};

/**
 * Obtener plan por cliente
 */
const getPlanByClientId = async (req, res) => {
  try {
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: 'clientId es requerido' });
    }

    const incluirCaido = String(req.query.incluirCaido || '').toLowerCase() === 'true';
    const plan = await planService.getPlanByClientId(clientId, { incluirCaido });

    if (!plan) {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }

    return res.status(200).json(plan);
  } catch (error) {
    console.error('Error al obtener plan:', error);
    return res.status(500).json({ error: 'Error al obtener plan' });
  }
};

/**
 * Cancelar plan (dar de baja)
 */
const cancelPlan = async (req, res) => {
  try {
    const { id: planId } = req.params;

    const plan = await planService.cancelPlan(planId);

    return res.status(200).json(plan);
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }

    if (error.message === 'PLAN_NOT_ACTIVE') {
      return res.status(400).json({ error: 'El plan no está activo' });
    }

    console.error('Error al cancelar plan:', error);
    return res.status(500).json({ error: 'Error al cancelar plan' });
  }
};

/**
 * Obtener planes caídos
 */
const getFallenPlans = async (req, res) => {
  try {
    const fallenPlans = await planService.getFallenPlans();

    return res.status(200).json(fallenPlans);
  } catch (error) {
    console.error('Error al obtener planes caídos:', error);
    return res.status(500).json({ error: 'Error al obtener planes caídos' });
  }
};

/**
 * Verificar y cancelar planes con mora
 */
const checkAndCancelOverduePlans = async (req, res) => {
  try {
    const result = await planService.checkAndCancelOverduePlans();

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error al verificar planes vencidos:', error);
    return res.status(500).json({ error: 'Error al verificar planes vencidos' });
  }
};

/**
 * Pasar plan a NEGOCIACION (alcanzó la cuota objetivo)
 */
const marcarNegociacion = async (req, res) => {
  try {
    const { id: planId } = req.params;
    const plan = await planService.marcarNegociacion(planId);
    return res.status(200).json(plan);
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }
    if (error.message === 'PLAN_NOT_ACTIVE') {
      return res.status(400).json({ error: 'El plan no está activo' });
    }
    if (error.message === 'INSUFFICIENT_INSTALLMENTS_PAID') {
      return res.status(400).json({ error: 'No se alcanzó la cuota objetivo para negociar', code: 'OBJETIVO_NO_CUMPLIDO' });
    }
    console.error('Error al marcar negociación:', error);
    return res.status(500).json({ error: 'Error al marcar negociación' });
  }
};

/**
 * Habilitar "pago abierto": el cliente alcanzó la cuota objetivo pero sigue pagando.
 * El plan pasa a sumar una cuota por mes hasta que eventualmente se negocie.
 */
const habilitarPagoAbierto = async (req, res) => {
  try {
    const { id: planId } = req.params;
    const plan = await planService.habilitarPagoAbierto(planId);
    return res.status(200).json(plan);
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }
    if (error.message === 'PLAN_NOT_ACTIVE') {
      return res.status(400).json({ error: 'El plan no está activo' });
    }
    if (error.message === 'INSUFFICIENT_INSTALLMENTS_PAID') {
      return res.status(400).json({ error: 'No se alcanzó la cuota objetivo' });
    }
    console.error('Error al habilitar pago abierto:', error);
    return res.status(500).json({ error: 'Error al habilitar pago abierto' });
  }
};

/**
 * Registrar entrega de capital (plan en NEGOCIACION) -> CashMovement automático
 */
const registrarEntregaCapital = async (req, res) => {
  try {
    const { id: planId } = req.params;
    // `comisionPct` puede venir de clientes viejos: se ignora (no existe comisión de negociación).
    const { monto, tipoEntrega, montoDinero, vehiculo, observacion } = req.body;

    // Compatibilidad: sin tipoEntrega es DINERO y `monto` es obligatorio.
    const tipo = String(tipoEntrega || 'DINERO').toUpperCase();
    if (tipo === 'DINERO' && (monto === undefined || monto === null) && (montoDinero === undefined || montoDinero === null)) {
      return res.status(400).json({ error: 'monto es requerido' });
    }

    const result = await planService.registrarEntregaCapital(planId, {
      monto,
      tipoEntrega,
      montoDinero,
      vehiculo,
      observacion,
      createdBy: req.user?.username || null,
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }
    if (error.message === 'PLAN_NOT_IN_NEGOTIATION') {
      return res.status(400).json({ error: 'El plan no está en negociación' });
    }
    if (ENTREGA_ERRORS[error.message]) {
      const [code, msg] = ENTREGA_ERRORS[error.message];
      return res.status(code).json({ error: msg });
    }
    console.error('Error al registrar entrega de capital:', error);
    return res.status(500).json({ error: 'Error al registrar entrega de capital' });
  }
};

/**
 * Resolver plan — flujo único (vehículo + entrega + gastos de retiro + devolución).
 */
const resolverPlan = async (req, res) => {
  try {
    const { id: planId } = req.params;
    const { vehiculo, entrega, gastoRetiro, devolucion, observacion,
            vehiculoData, boletoCompraventa, contratoMutuo } = req.body;

    const result = await planService.resolverPlan(planId, {
      vehiculo,
      entrega,
      gastoRetiro,
      devolucion,
      observacion,
      vehiculoData,
      boletoCompraventa,
      contratoMutuo,
      createdBy: req.user?.username || null,
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error.message === 'INSUFFICIENT_INSTALLMENTS_PAID') {
      return res.status(400).json({
        error: objetivoNoCumplidoMsg(error, 'No se alcanzó la cuota objetivo'),
        code: 'OBJETIVO_NO_CUMPLIDO',
        objetivo: error.objetivo || null,
      });
    }
    const map = {
      ...ENTREGA_ERRORS,
      PLAN_NOT_FOUND: [404, 'Plan no encontrado'],
      PLAN_NOT_RESOLVABLE: [400, 'El plan no se puede resolver en su estado actual'],
      INVALID_VEHICLE_RESULT: [400, 'Resultado de vehículo inválido (NO_RETIRO, AUTO o MOTO)'],
    };
    if (map[error.message]) {
      const [code, msg] = map[error.message];
      return res.status(code).json({ error: msg });
    }
    // Categoría faltante (migración/seed no aplicado): devolver detalle claro.
    if (error.message && error.message.startsWith('CASH_CATEGORY_NOT_FOUND')) {
      return res.status(409).json({
        error: 'Falta una categoría de caja del sistema. Ejecutá las migraciones y el seed.',
        detail: error.message,
      });
    }
    console.error('Error al resolver el plan:', error);
    return res.status(500).json({ error: 'Error al resolver el plan', detail: error.message });
  }
};

/**
 * Iniciar saldo — genera las cuotas de la etapa SALDO.
 */
const iniciarSaldo = async (req, res) => {
  try {
    const { id: planId } = req.params;
    const { fechaEntrega, cantidadCuotas, montoCuota } = req.body;

    if (cantidadCuotas === undefined || montoCuota === undefined) {
      return res.status(400).json({ error: 'cantidadCuotas y montoCuota son requeridos' });
    }

    const result = await planService.iniciarSaldo(planId, { fechaEntrega, cantidadCuotas, montoCuota });
    return res.status(201).json(result);
  } catch (error) {
    const map = {
      PLAN_NOT_FOUND: [404, 'Plan no encontrado'],
      PLAN_NOT_RESOLVED: [400, 'El plan debe estar resuelto para iniciar el saldo'],
      SALDO_ALREADY_STARTED: [409, 'El saldo ya fue iniciado'],
      INVALID_SALDO_CANTIDAD: [400, 'La cantidad de cuotas debe ser mayor a 0'],
      INVALID_SALDO_MONTO: [400, 'El monto de cuota debe ser mayor a 0'],
      INVALID_FECHA_ENTREGA: [400, 'Fecha de entrega inválida'],
    };
    if (map[error.message]) {
      const [code, msg] = map[error.message];
      return res.status(code).json({ error: msg });
    }
    console.error('Error al iniciar saldo:', error);
    return res.status(500).json({ error: 'Error al iniciar saldo', detail: error.message });
  }
};

/**
 * Obtener las cuotas de saldo de un cliente.
 */
const getSaldo = async (req, res) => {
  try {
    const { clientId } = req.query;
    if (!clientId) return res.status(400).json({ error: 'clientId es requerido' });
    const saldo = await planService.getSaldoByClientId(clientId);
    if (!saldo) return res.status(404).json({ error: 'El cliente no tiene saldo iniciado' });
    return res.json(saldo);
  } catch (error) {
    console.error('Error al obtener saldo:', error);
    return res.status(500).json({ error: 'Error al obtener saldo' });
  }
};

// ============================================================
// OBJETIVO / AJUSTES (regularización del saldo objetivo) / HISTORIAL
// ============================================================

const AJUSTE_ERRORS = {
  PLAN_NOT_FOUND: [404, 'Plan no encontrado'],
  PLAN_NOT_ACTIVE: [400, 'Solo se puede ajustar el objetivo de un plan activo (no negociado)'],
  PLAN_SIN_OBJETIVO: [400, 'El plan no tiene cuota objetivo configurada'],
  OBJETIVO_YA_CUMPLIDO: [409, 'El objetivo ya está cumplido: no hay saldo de cuota para ajustar (los cargos no se ajustan)'],
  AJUSTE_CON_PAGOS_POSTERIORES: [409, 'No se puede anular: después del ajuste se cobraron cargos de esa cuota'],
  INVALID_AJUSTE_TIPO: [400, 'Tipo de ajuste inválido (AJUSTE_COMERCIAL, CONDONACION u OTRO)'],
  AJUSTE_MOTIVO_REQUERIDO: [400, 'El motivo del ajuste es obligatorio'],
  INVALID_AMOUNT: [400, 'El monto del ajuste debe ser mayor a 0'],
  AJUSTE_NOT_FOUND: [404, 'Ajuste no encontrado'],
  AJUSTE_YA_ANULADO: [409, 'El ajuste ya está anulado'],
  ANULACION_MOTIVO_REQUERIDO: [400, 'El motivo de la anulación es obligatorio'],
};

const handleAjusteError = (res, error, fallback) => {
  if (error.message === 'AJUSTE_EXCEDE_SALDO') {
    return res.status(400).json({
      error: `El ajuste excede el saldo ajustable de las cuotas del objetivo (${formatMoney(error.saldoPendienteEfectivo)})`,
      code: 'AJUSTE_EXCEDE_SALDO',
      saldoPendienteEfectivo: error.saldoPendienteEfectivo,
    });
  }
  if (AJUSTE_ERRORS[error.message]) {
    const [code, msg] = AJUSTE_ERRORS[error.message];
    return res.status(code).json({ error: msg, code: error.message });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ error: fallback, detail: error.message });
};

const authUser = (req) => ({ id: req.user?.id || null, username: req.user?.username || null });

/** GET /plans/:id/objetivo — resumen calculado por la regla de dominio única. */
const getObjetivo = async (req, res) => {
  try {
    return res.json(await ajusteObjetivoService.getObjetivo(req.params.id));
  } catch (error) {
    return handleAjusteError(res, error, 'Error al obtener el objetivo del plan');
  }
};

/** GET /plans/:id/ajustes-objetivo */
const listarAjustes = async (req, res) => {
  try {
    return res.json(await ajusteObjetivoService.listarAjustes(req.params.id));
  } catch (error) {
    return handleAjusteError(res, error, 'Error al obtener los ajustes');
  }
};

/** POST /plans/:id/ajustes-objetivo — { tipo, monto, motivo }. No genera movimientos de Caja. */
const crearAjuste = async (req, res) => {
  try {
    const { tipo, monto, motivo } = req.body || {};
    const result = await ajusteObjetivoService.crearAjuste(req.params.id, { tipo, monto, motivo, user: authUser(req) });
    return res.status(201).json(result);
  } catch (error) {
    return handleAjusteError(res, error, 'Error al registrar el ajuste');
  }
};

/** POST /plans/:id/ajustes-objetivo/:ajusteId/anular — { motivo }. No borra: anula. */
const anularAjuste = async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const result = await ajusteObjetivoService.anularAjuste(req.params.id, req.params.ajusteId, { motivo, user: authUser(req) });
    return res.json(result);
  } catch (error) {
    if (error.message === 'PLAN_NOT_ACTIVE') {
      return res.status(409).json({ error: 'No se puede anular: el plan ya fue negociado', code: 'PLAN_NOT_ACTIVE' });
    }
    return handleAjusteError(res, error, 'Error al anular el ajuste');
  }
};

// ============================================================
// MODIFICAR VALOR DE CUOTA (no es pago, ni ajuste, ni refinanciación)
// ============================================================

const MODIFICACION_ERRORS = {
  PLAN_NOT_FOUND: [404, 'Plan no encontrado'],
  PLAN_NO_MODIFICABLE: [400, 'Solo se puede modificar el valor de cuota de un plan activo o caído (no en negociación, resuelto ni retirado)'],
  VERSION_REQUERIDA: [400, 'Falta la versión de la vista previa. Calculá la vista previa antes de confirmar.'],
  VISTA_PREVIA_DESACTUALIZADA: [409, 'Los datos del plan cambiaron desde la vista previa (pago, ajuste u otra modificación). Actualizá la vista previa y volvé a confirmar.'],
  INVALID_MONTO: [400, 'El nuevo valor por cuota debe ser un importe mayor a 0'],
  MOTIVO_REQUERIDO: [400, 'El motivo de la modificación es obligatorio'],
  SIN_CUOTAS_MODIFICABLES: [409, 'El plan no tiene cuotas abiertas para modificar'],
  SIN_CAMBIOS: [409, 'Las cuotas abiertas ya tienen ese importe'],
  CONCURRENT_MODIFICATION: [409, 'Las cuotas cambiaron mientras se guardaba. Volvé a intentarlo.'],
};

const handleModificacionError = (res, error, fallback) => {
  if (error.message === 'CUOTAS_INCOMPATIBLES') {
    const inc = error.preview?.incompatibles || [];
    return res.status(409).json({
      error: inc.length === 1 ? `Cuota ${inc[0].numero}: ${inc[0].motivo}` : `Hay ${inc.length} cuotas que no admiten el nuevo importe`,
      code: 'CUOTAS_INCOMPATIBLES',
      incompatibles: inc,
      preview: error.preview,
    });
  }
  if (error.message === 'CONFIRMACION_NEGOCIACION_REQUERIDA') {
    const efecto = error.preview?.objetivo?.efectoNegociacion;
    return res.status(409).json({
      error: efecto === 'HABILITA'
        ? 'Esta modificación habilita la negociación del plan. Confirmá explícitamente ese efecto.'
        : 'Esta modificación deja el objetivo sin cumplir y deshabilita la negociación. Confirmá explícitamente ese efecto.',
      code: 'CONFIRMACION_NEGOCIACION_REQUERIDA',
      preview: error.preview,
    });
  }
  if (MODIFICACION_ERRORS[error.message]) {
    const [code, msg] = MODIFICACION_ERRORS[error.message];
    return res.status(code).json({ error: msg, code: error.message, preview: error.preview || undefined });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ error: fallback, detail: error.message });
};

/** GET /plans/:id/modificar-cuotas/preview?nuevoMonto= — solo lectura, calculado por el backend. */
const previewModificacionCuotas = async (req, res) => {
  try {
    return res.json(await modificacionCuotaService.previsualizar(req.params.id, req.query.nuevoMonto));
  } catch (error) {
    return handleModificacionError(res, error, 'Error al calcular la vista previa');
  }
};

/** POST /plans/:id/modificar-cuotas — { nuevoMonto, motivo, versionVistaPrevia, aceptaCambioNegociacion }. No genera movimientos de Caja. */
const modificarCuotas = async (req, res) => {
  try {
    const { nuevoMonto, motivo, aceptaCambioNegociacion, versionVistaPrevia } = req.body || {};
    const result = await modificacionCuotaService.modificarCuotas(req.params.id, {
      nuevoMonto, motivo, aceptaCambioNegociacion, versionVistaPrevia, user: authUser(req),
    });
    return res.status(201).json(result);
  } catch (error) {
    return handleModificacionError(res, error, 'Error al modificar el valor de cuota');
  }
};

// ============================================================
// REACTIVAR PLAN CAÍDO (cambio de estado explícito; no es pago ni ajuste)
// ============================================================

const REACTIVACION_ERRORS = {
  PLAN_NOT_FOUND: [404, 'Plan no encontrado'],
  PLAN_NO_CAIDO: [400, 'Solo se puede reactivar un plan en estado CAÍDO'],
  MOTIVO_REQUERIDO: [400, 'El motivo de la reactivación es obligatorio'],
  VERSION_REQUERIDA: [400, 'Falta la versión de la vista previa. Actualizá la vista previa antes de confirmar.'],
  VISTA_PREVIA_DESACTUALIZADA: [409, 'Los datos del plan cambiaron desde la vista previa (pago, ajuste u otra modificación). Actualizá la vista previa y volvé a confirmar.'],
  OTRO_PLAN_VIGENTE: [409, 'El cliente ya tiene otro plan vigente: no se puede reactivar este plan'],
  REACTIVACION_NO_CUMPLE: [409, 'El plan todavía tiene 3 o más cuotas vencidas impagas'],
  CONFIRMACION_ORIGEN_REQUERIDA: [409, 'Confirmá explícitamente la advertencia sobre el origen de la caída'],
};

const handleReactivacionError = (res, error, fallback) => {
  if (REACTIVACION_ERRORS[error.message]) {
    const [code, msg] = REACTIVACION_ERRORS[error.message];
    const detalle = error.message === 'REACTIVACION_NO_CUMPLE' && error.preview?.motivoBloqueo
      ? error.preview.motivoBloqueo : msg;
    return res.status(code).json({ error: detalle, code: error.message, preview: error.preview || undefined });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ error: fallback, detail: error.message });
};

/** GET /plans/:id/reactivar/preview — vencidas impagas, importe mínimo, advertencias. */
const previewReactivacion = async (req, res) => {
  try {
    return res.json(await reactivacionService.previsualizar(req.params.id));
  } catch (error) {
    return handleReactivacionError(res, error, 'Error al calcular la reactivación');
  }
};

/** POST /plans/:id/reactivar — { motivo, versionVistaPrevia, confirmaOrigenCaida }. */
const reactivarPlan = async (req, res) => {
  try {
    const { motivo, versionVistaPrevia, confirmaOrigenCaida } = req.body || {};
    const result = await reactivacionService.reactivarPlan(req.params.id, {
      motivo, versionVistaPrevia, confirmaOrigenCaida, user: authUser(req),
    });
    return res.status(201).json(result);
  } catch (error) {
    return handleReactivacionError(res, error, 'Error al reactivar el plan');
  }
};

/** GET /plans/:id/historial */
const getHistorial = async (req, res) => {
  try {
    return res.json(await planService.getHistorial(req.params.id));
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') return res.status(404).json({ error: 'Plan no encontrado' });
    console.error('Error al obtener historial del plan:', error);
    return res.status(500).json({ error: 'Error al obtener historial del plan' });
  }
};

module.exports = {
  createPlan,
  retirarVehiculo,
  getPlanById,
  getPlanByClientId,
  cancelPlan,
  getFallenPlans,
  checkAndCancelOverduePlans,
  marcarNegociacion,
  habilitarPagoAbierto,
  registrarEntregaCapital,
  resolverPlan,
  iniciarSaldo,
  getSaldo,
  getObjetivo,
  listarAjustes,
  crearAjuste,
  anularAjuste,
  previewModificacionCuotas,
  modificarCuotas,
  previewReactivacion,
  reactivarPlan,
  getHistorial,
};
