/**
 * Obtiene el porcentaje de comisión para una cuota específica
 * @param {number} numeroCuota - Número de la cuota (1, 2, 3, ...)
 * @param {object} config - Objeto de configuración
 * @returns {number} Porcentaje de comisión (0-100)
 */
const getCommissionForInstallment = (numeroCuota, config) => {
  // Si existe commissionRules, usar reglas dinámicas
  if (config.commissionRules && Array.isArray(config.commissionRules)) {
    const rule = config.commissionRules.find(r => r.cuota === numeroCuota);
    return rule ? rule.porcentaje : 0;
  }
  
  // Backward compatibility: usar lógica antigua
  // Cuota 1 y 2 tienen comisión según comisionPorcentaje
  if (numeroCuota === 1 || numeroCuota === 2) {
    return config.comisionPorcentaje || 0;
  }
  
  return 0;
};

/**
 * Calcula el monto de comisión para una cuota
 * @param {number} numeroCuota - Número de la cuota
 * @param {number} montoCuota - Monto base de la cuota
 * @param {object} config - Objeto de configuración
 * @returns {number} Monto de comisión en pesos
 */
const calculateCommissionAmount = (numeroCuota, montoCuota, config) => {
  const porcentaje = getCommissionForInstallment(numeroCuota, config);
  return montoCuota * (porcentaje / 100);
};

module.exports = {
  getCommissionForInstallment,
  calculateCommissionAmount
};
