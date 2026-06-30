const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');

router.post('/', vehicleController.createVehicle);
router.get('/', vehicleController.getVehicles);
router.put('/assign', vehicleController.assignVehicle);
router.put('/unassign', vehicleController.unassignVehicle);
router.get('/:clientId', vehicleController.getVehicleByClientId);

module.exports = router;
