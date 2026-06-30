const salesService = require('../services/salesService');

const createSale = async (req, res) => {
  try {
    // Soportar tanto el formato antiguo como el nuevo
    const { 
      clientId, 
      precioTotal, 
      entregaInicial, 
      cantidadCuotas, 
      fechaInicio,
      // Nuevos campos del flujo unificado
      vehicleId,
      precioFinal,
      fechaPrimeraCuota,
      // Campos porcentuales
      administrativoPct,
      selladoPct,
      retiroPct
    } = req.body;

    // Determinar qué campos usar (nuevos o antiguos)
    const finalClientId = clientId;
    const finalPrecioTotal = precioFinal || precioTotal;
    const finalEntregaInicial = entregaInicial;
    const finalCantidadCuotas = cantidadCuotas;
    const finalFechaInicio = fechaPrimeraCuota || fechaInicio;
    const finalVehicleId = vehicleId;

    // Validaciones básicas
    if (
      finalClientId === undefined ||
      finalPrecioTotal === undefined ||
      finalEntregaInicial === undefined ||
      finalCantidadCuotas === undefined ||
      !finalFechaInicio
    ) {
      return res.status(400).json({
        error: 'Todos los campos son requeridos: clientId, precioTotal (o precioFinal), entregaInicial, cantidadCuotas, fechaInicio (o fechaPrimeraCuota)',
      });
    }

    const parsedClientId = Number(finalClientId);
    const parsedPrecioTotal = Number(finalPrecioTotal);
    const parsedEntregaInicial = Number(finalEntregaInicial);
    const parsedCantidadCuotas = Number(finalCantidadCuotas);

    if (
      Number.isNaN(parsedClientId) ||
      Number.isNaN(parsedPrecioTotal) ||
      Number.isNaN(parsedEntregaInicial) ||
      Number.isNaN(parsedCantidadCuotas)
    ) {
      return res.status(400).json({
        error: 'clientId, precioTotal, entregaInicial y cantidadCuotas deben ser numéricos',
      });
    }

    if (parsedPrecioTotal <= 0 || parsedEntregaInicial < 0 || parsedCantidadCuotas <= 0) {
      return res.status(400).json({
        error: 'precioTotal y cantidadCuotas deben ser mayores a 0, entregaInicial mayor o igual a 0',
      });
    }

    if (parsedEntregaInicial > parsedPrecioTotal) {
      return res.status(400).json({
        error: 'La entrega inicial no puede ser mayor al precio total',
      });
    }

    // Preparar datos para el servicio
    const saleData = {
      clientId: parsedClientId,
      precioTotal: parsedPrecioTotal,
      entregaInicial: parsedEntregaInicial,
      cantidadCuotas: parsedCantidadCuotas,
      fechaInicio: finalFechaInicio,
    };

    // Agregar vehicleId si viene en el nuevo formato
    if (finalVehicleId) {
      saleData.vehicleId = Number(finalVehicleId);
    }

    // Agregar porcentajes si vienen
    if (administrativoPct !== undefined) {
      saleData.administrativoPct = Number(administrativoPct);
    }
    if (selladoPct !== undefined) {
      saleData.selladoPct = Number(selladoPct);
    }
    if (retiroPct !== undefined) {
      saleData.retiroPct = Number(retiroPct);
    }

    const result = await salesService.createSale(saleData);

    return res.status(201).json(result);
  } catch (error) {
    if (error.message === 'CLIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    if (error.message === 'VEHICLE_NOT_FOUND') {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    if (error.message === 'VEHICLE_NOT_AVAILABLE') {
      return res.status(409).json({ error: 'El vehículo no está disponible' });
    }

    if (error.message === 'ACTIVE_OPERATION_EXISTS') {
      return res.status(409).json({ error: 'El cliente ya tiene una operación activa' });
    }

    console.error('Error al crear venta:', error);
    return res.status(500).json({ error: 'Error al crear venta' });
  }
};

const getSaleByClientId = async (req, res) => {
  try {
    const { clientId } = req.query;

    if (!clientId) {
      return res.status(400).json({ error: 'clientId es requerido' });
    }

    const parsedClientId = Number(clientId);
    if (Number.isNaN(parsedClientId)) {
      return res.status(400).json({ error: 'clientId debe ser numérico' });
    }

    const sale = await salesService.getSaleByClientId(parsedClientId);

    if (!sale) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    return res.status(200).json(sale);
  } catch (error) {
    console.error('Error al obtener venta:', error);
    return res.status(500).json({ error: 'Error al obtener venta' });
  }
};

module.exports = {
  createSale,
  getSaleByClientId,
};
