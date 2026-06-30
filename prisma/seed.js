const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { CASH_CATEGORIES } = require('../src/constants/cashCategories');

const prisma = new PrismaClient();

async function seedAdmin() {
  const existingAdmin = await prisma.user.findUnique({
    where: { username: 'admin' }
  });

  if (existingAdmin) {
    console.log('⚠️  El usuario admin ya existe. No se creará uno nuevo.');
    return;
  }

  const hashedPassword = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash: hashedPassword,
      email: 'admin@backoffice.com',
      role: 'ADMIN',
      active: true
    }
  });

  console.log('✅ Usuario administrador creado. Username: admin / Password: admin123 / ID:', admin.id);
}

async function seedCashCategories() {
  let created = 0;
  for (const cat of CASH_CATEGORIES) {
    // `label` es solo para la UI, no es columna de la tabla.
    const data = {
      name: cat.name,
      type: cat.type,
      system: cat.system,
      isManual: cat.isManual,
      requiresClient: cat.requiresClient,
    };
    await prisma.cashMovementCategory.upsert({
      where: { name: cat.name },
      update: { type: data.type, system: data.system, isManual: data.isManual, requiresClient: data.requiresClient },
      create: data,
    });
    created++;
  }
  console.log(`✅ Categorías de caja sincronizadas (${created}).`);
}

async function seedExtraUsers() {
  const users = [
    { username: 'lautaro.ferin', email: 'lautaro.ferin@gmail.com', role: 'USER' },
    { username: 'supervisor', email: 'supervisor@gmail.com', role: 'USER' },
  ];

  const hashedPassword = await bcrypt.hash('12345', 10);

  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        username: u.username,
        passwordHash: hashedPassword,
        email: u.email,
        role: u.role,
        active: true,
      },
    });
    console.log(`✅ Usuario creado/verificado: ${u.username} (${u.email})`);
  }
}

async function main() {
  console.log('🌱 Iniciando seed...');
  await seedAdmin();
  await seedExtraUsers();
  await seedCashCategories();
}

main()
  .catch((e) => {
    console.error('❌ Error durante el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
