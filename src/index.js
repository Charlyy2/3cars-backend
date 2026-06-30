const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const clientRoutes = require('./routes/clientRoutes');
const clientStatusRoutes = require('./routes/clientStatusRoutes');
const customerBalanceRoutes = require('./routes/customerBalanceRoutes');
const installmentRoutes = require('./routes/installmentRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const financingRoutes = require('./routes/financingRoutes');
const collectionRoutes = require('./routes/collectionRoutes');
const salesRoutes = require('./routes/salesRoutes');
const operationsRoutes = require('./routes/operationsRoutes');
const audioRoutes = require('./routes/audioRoutes');
const configRoutes = require('./routes/configRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const planRoutes = require('./routes/planRoutes');
const cobranzasRoutes = require('./routes/cobranzasRoutes');
const authRoutes = require('./routes/authRoutes');
const fileRoutes = require('./routes/fileRoutes');
const cashMovementRoutes = require('./routes/cashMovementRoutes');
const { authenticateToken } = require('./middleware/authMiddleware');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: [
    'https://3cars.com.ar',
    'https://www.3cars.com.ar',

    // Desarrollo
    'http://localhost:4200',
    'http://localhost:8080'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/clients', authenticateToken, clientRoutes);
app.use('/clients', authenticateToken, clientStatusRoutes);
app.use('/clients', authenticateToken, customerBalanceRoutes);
app.use('/installments', authenticateToken, installmentRoutes);
app.use('/payments', authenticateToken, paymentRoutes);
app.use('/financing', authenticateToken, financingRoutes);
app.use('/cobranzas', authenticateToken, collectionRoutes);
app.use('/sales', authenticateToken, salesRoutes);
app.use('/operations', authenticateToken, operationsRoutes);
app.use('/audios', authenticateToken, audioRoutes);
app.use('/config', authenticateToken, configRoutes);
app.use('/vehicles', authenticateToken, vehicleRoutes);
app.use('/plans', authenticateToken, planRoutes);
app.use('/cobranzas-op', authenticateToken, cobranzasRoutes);
app.use('/files', authenticateToken, fileRoutes);
app.use('/cash-movements', authenticateToken, cashMovementRoutes);
app.use('/', authenticateToken, metricsRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'API funcionando correctamente' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  console.log('Conexión a base de datos cerrada');
  process.exit(0);
});
