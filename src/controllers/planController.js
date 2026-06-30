const planService = require('../services/planService');

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
      return res.status(409).json({ error: 'El cliente ya tiene un plan activo' });
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

    const plan = await planService.getPlanByClientId(clientId);

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
      return res.status(400).json({ error: 'No se alcanzó la cuota objetivo para negociar' });
    }
    console.error('Error al marcar negociación:', error);
    return res.status(500).json({ error: 'Error al marcar negociación' });
  }
};

/**
 * Registrar entrega de capital (plan en NEGOCIACION) -> CashMovement automático
 */
const registrarEntregaCapital = async (req, res) => {
  try {
    const { id: planId } = req.params;
    const { monto, observacion } = req.body;

    if (monto === undefined || monto === null) {
      return res.status(400).json({ error: 'monto es requerido' });
    }

    const result = await planService.registrarEntregaCapital(planId, {
      monto,
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
    if (error.message === 'INVALID_AMOUNT') {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
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
    const map = {
      PLAN_NOT_FOUND: [404, 'Plan no encontrado'],
      PLAN_NOT_RESOLVABLE: [400, 'El plan no se puede resolver en su estado actual'],
      INSUFFICIENT_INSTALLMENTS_PAID: [400, 'No se alcanzó la cuota objetivo'],
      INVALID_VEHICLE_RESULT: [400, 'Resultado de vehículo inválido (NO_RETIRO, AUTO o MOTO)'],
      INVALID_COMMISSION_PCT: [400, 'El porcentaje de comisión debe estar entre 0 y 100'],
      NEGATIVE_AMOUNT: [400, 'Los montos no pueden ser negativos'],
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

module.exports = {
  createPlan,
  retirarVehiculo,
  getPlanById,
  getPlanByClientId,
  cancelPlan,
  getFallenPlans,
  checkAndCancelOverduePlans,
  marcarNegociacion,
  registrarEntregaCapital,
  resolverPlan,
  iniciarSaldo,
  getSaldo,
};
