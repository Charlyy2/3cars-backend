const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const roundCurrency = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const getCollectionReport = async (modo) => {
  // Obtener todas las cuotas no pagadas
  const unpaidInstallments = await prisma.installment.findMany({
    where: {
      estado: {
        in: ['PENDIENTE', 'PARCIAL']
      }
    },
    include: {
      plan: {
        include: {
          client: {
            select: {
              id: true,
              nombre: true
            }
          }
        }
      }
    },
    orderBy: {
      numero: 'asc'
    }
  });

  // Agrupar por cliente
  const clientMap = new Map();

  for (const installment of unpaidInstallments) {
    const clientId = installment.plan.client.id;
    
    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, {
        clientId,
        nombre: installment.plan.client.nombre,
        cuotas: []
      });
    }
    
    clientMap.get(clientId).cuotas.push(installment);
  }

  // Procesar cada cliente
  const clientsWithDebt = [];
  const today = new Date();

  for (const [clientId, clientData] of clientMap) {
    const cuotas = clientData.cuotas;
    
    // Encontrar primera cuota no pagada (menor número)
    const primeraCuota = cuotas.reduce((min, cuota) => 
      cuota.numero < min.numero ? cuota : min
    );

    // Calcular deuda vencida
    let deudaVencida = 0;
    for (const cuota of cuotas) {
      const isOverdue = cuota.fechaVencimiento < today;
      const remainingDebt = cuota.total - cuota.pagado;
      
      if (isOverdue && remainingDebt > 0) {
        deudaVencida += remainingDebt;
      }
    }

    // Calcular total a pagar según regla final del negocio
    const remainingDebtPrimeraCuota = primeraCuota.total - primeraCuota.pagado;
    const primeraCuotaVencida = primeraCuota.fechaVencimiento < today;
    
    let totalAPagar;
    
    if (modo === 'estricto') {
      // Regla final del negocio
      if (deudaVencida > 0) {
        // Hay deuda vencida: cobrar deuda + cuota actual si no está incluida
        if (primeraCuotaVencida) {
          totalAPagar = deudaVencida; // Ya incluida
        } else {
          totalAPagar = deudaVencida + remainingDebtPrimeraCuota;
        }
      } else {
        // No hay deuda vencida: cobrar solo cuota actual (monto pendiente real)
        totalAPagar = remainingDebtPrimeraCuota;
      }
    } else {
      // Modo flexible: solo deuda vencida
      totalAPagar = deudaVencida;
    }

    // Calcular estado del cliente
    const allInstallments = await prisma.installment.findMany({
      where: {
        plan: {
          clientId: clientId
        }
      },
      orderBy: {
        numero: 'asc'
      }
    });

    let overdueInstallments = 0;
    let maxConsecutiveUnpaid = 0;
    let currentConsecutive = 0;

    for (const installment of allInstallments) {
      const isOverdue = installment.fechaVencimiento < today;
      const isUnpaid = installment.estado !== 'PAGADO';

      if (isOverdue && isUnpaid) {
        overdueInstallments++;
        currentConsecutive++;
        maxConsecutiveUnpaid = Math.max(maxConsecutiveUnpaid, currentConsecutive);
      } else {
        currentConsecutive = 0;
      }
    }

    let estadoCliente;
    if (maxConsecutiveUnpaid >= 3) {
      estadoCliente = 'CAIDO';
    } else if (overdueInstallments >= 1) {
      estadoCliente = 'ATRASADO';
    } else {
      estadoCliente = 'AL_DIA';
    }

    clientsWithDebt.push({
      clientId,
      nombre: clientData.nombre,
      installmentId: primeraCuota.id,
      cuotaActualNumero: primeraCuota.numero,
      cuotaActualMonto: roundCurrency(remainingDebtPrimeraCuota),
      deudaVencida: roundCurrency(deudaVencida),
      totalAPagar: roundCurrency(totalAPagar),
      cuotaActualEstado: primeraCuota.estado,
      estadoCliente
    });
  }

  // Ordenar: CAIDOS primero, luego ATRASADOS, luego AL_DIA
  const priorityOrder = { 'CAIDO': 0, 'ATRASADO': 1, 'AL_DIA': 2 };
  
  clientsWithDebt.sort((a, b) => {
    const priorityA = priorityOrder[a.estadoCliente];
    const priorityB = priorityOrder[b.estadoCliente];
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // Si mismo estado, ordenar por total a pagar (mayor primero)
    return b.totalAPagar - a.totalAPagar;
  });

  return clientsWithDebt;
};

module.exports = {
  getCollectionReport
};
