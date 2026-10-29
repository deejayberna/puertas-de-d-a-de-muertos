'use strict';
/**
 * Puertas de Día de Muertos — servidor local
 * Ejecuta: npm start  o  iniciar.bat
 */
const os = require('os');
const { app, PORT, DEFAULT_PASSWORD, ADMIN_PASSWORD } = require('./app');

app.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if ((n.family === 'IPv4' || n.family === 4) && !n.internal) ips.push(n.address);
    }
  }
  console.log('\n  💀  PUERTAS DE DÍA DE MUERTOS  🕯️\n');
  console.log(`  Página principal:  http://localhost:${PORT}`);
  ips.forEach((ip) => console.log(`  Desde celulares (misma WiFi):  http://${ip}:${PORT}`));
  console.log(`  Panel de administración:  http://localhost:${PORT}/admin`);
  console.log(`  Pantalla de resultados:   http://localhost:${PORT}/resultados`);
  if (ADMIN_PASSWORD === DEFAULT_PASSWORD) {
    console.log(`\n  ⚠ Contraseña de admin por defecto: ${DEFAULT_PASSWORD}  (cámbiala con ADMIN_PASSWORD)`);
  }
  console.log('');
});
