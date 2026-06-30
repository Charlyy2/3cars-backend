const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');

// GET /clients - Obtener todos los clientes
router.get('/', clientController.getAllClients);

// GET /clients/:id - Obtener un cliente específico
router.get('/:id', clientController.getClientById);

// POST /clients - Crear un nuevo cliente
router.post('/', clientController.createClient);

// PUT /clients/:id - Actualizar un cliente
router.put('/:id', clientController.updateClient);

// DELETE /clients/:id - Eliminar un cliente
router.delete('/:id', clientController.deleteClient);

module.exports = router;
