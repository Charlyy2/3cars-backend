import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de usuario administrador...');

  // Verificar si ya existe un usuario admin
  const existingAdmin = await prisma.user.findUnique({
    where: { username: 'admin' }
  });

  if (existingAdmin) {
    console.log('⚠️  El usuario admin ya existe. No se creará uno nuevo.');
    return;
  }

  // Crear usuario administrador
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

  console.log('✅ Usuario administrador creado exitosamente:');
  console.log('   Username: admin');
  console.log('   Password: admin123');
  console.log('   Email: admin@backoffice.com');
  console.log('   Role: ADMIN');
  console.log('   ID:', admin.id);
}

main()
  .catch((e) => {
    console.error('❌ Error durante el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
