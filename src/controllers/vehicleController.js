const vehicleService = require('../services/vehicleService');

const createVehicle = async (req, res) => {
  try {
    const { dominio, patente, modelo, anio } = req.body;

    if (!dominio || !patente || !modelo || anio === undefined) {
      return res.status(400).json({
        error: 'Todos los campos son requeridos: dominio, patente, modelo, anio',
      });
    }

    const parsedAnio = Number(anio);

    if (Number.isNaN(parsedAnio)) {
      return res.status(400).json({
        error: 'anio debe ser numérico',
      });
    }

    if (parsedAnio < 1900) {
      return res.status(400).json({
        error: 'anio debe ser mayor o igual a 1900',
      });
    }

    const vehicle = await vehicleService.createVehicle({
      dominio: String(dominio).trim(),
      patente: String(patente).trim(),
      modelo: String(modelo).trim(),
      anio: parsedAnio,
    });

    return res.status(201).json(vehicle);
  } catch (error) {
    console.error('Error al crear vehículo:', error);
    return res.status(500).json({ error: 'Error al crear vehículo' });
  }
};

const getVehicles = async (req, res) => {
  try {
    const { disponible } = req.query;
    let availableFilter;

    if (disponible === 'true') {
      availableFilter = true;
    }

    if (disponible === 'false') {
      availableFilter = false;
    }

    const vehicles = await vehicleService.getVehicles({
      disponible: availableFilter,
    });

    return res.json(vehicles);
  } catch (error) {
    console.error('Error al obtener vehículos:', error);
    return res.status(500).json({ error: 'Error al obtener vehículos' });
  }
};

const assignVehicle = async (req, res) => {
  try {
    const { vehicleId, clientId } = req.body;

    if (!vehicleId || !clientId) {
      return res.status(400).json({ error: 'vehicleId y clientId son requeridos' });
    }

    const parsedVehicleId = Number(vehicleId);
    const parsedClientId = Number(clientId);

    if (Number.isNaN(parsedVehicleId) || Number.isNaN(parsedClientId)) {
      return res.status(400).json({ error: 'vehicleId y clientId deben ser numéricos' });
    }

    const vehicle = await vehicleService.assignVehicle({
      vehicleId: parsedVehicleId,
      clientId: parsedClientId,
    });

    return res.json(vehicle);
  } catch (error) {
    if (error.message === 'VEHICLE_NOT_FOUND') {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    if (error.message === 'CLIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    if (error.message === 'VEHICLE_NOT_AVAILABLE') {
      return res.status(409).json({ error: 'El vehículo no está disponible' });
    }

    if (error.message === 'CLIENT_ALREADY_HAS_VEHICLE') {
      return res.status(409).json({ error: 'El cliente ya tiene un vehículo asignado' });
    }

    console.error('Error al asignar vehículo:', error);
    return res.status(500).json({ error: 'Error al asignar vehículo' });
  }
};

const unassignVehicle = async (req, res) => {
  try {
    const { vehicleId } = req.body;

    if (!vehicleId) {
      return res.status(400).json({ error: 'vehicleId es requerido' });
    }

    const parsedVehicleId = Number(vehicleId);

    if (Number.isNaN(parsedVehicleId)) {
      return res.status(400).json({ error: 'vehicleId debe ser numérico' });
    }

    const vehicle = await vehicleService.unassignVehicle({ vehicleId: parsedVehicleId });
    return res.json(vehicle);
  } catch (error) {
    if (error.message === 'VEHICLE_NOT_FOUND') {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    console.error('Error al desasignar vehículo:', error);
    return res.status(500).json({ error: 'Error al desasignar vehículo' });
  }
};

const getVehicleByClientId = async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clientId || Number.isNaN(Number(clientId))) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }

    const vehicle = await vehicleService.getVehicleByClientId(clientId);

    if (!vehicle) {
      return res.status(404).json({ error: 'Vehículo no encontrado para este cliente' });
    }

    return res.json(vehicle);
  } catch (error) {
    console.error('Error al obtener vehículo por cliente:', error);
    return res.status(500).json({ error: 'Error al obtener vehículo' });
  }
};

module.exports = {
  createVehicle,
  getVehicles,
  assignVehicle,
  unassignVehicle,
  getVehicleByClientId,
};
