# 💀 Puertas de Día de Muertos

App web para votar por la puerta favorita del concurso. Un solo voto por dispositivo.

## Cómo arrancarla

1. Necesitas **Node.js** (https://nodejs.org, versión LTS).
2. Doble clic en **`iniciar.bat`**. La primera vez instala lo necesario (requiere internet) y abre el navegador.
3. Deja la ventana negra abierta mientras dure la votación.

| Página | Dirección |
|---|---|
| Votación (público) | http://localhost:3000 |
| Panel de administración | http://localhost:3000/admin |
| Pantalla para proyector | http://localhost:3000/resultados |

**Contraseña de admin por defecto:** `catrina2026` → cámbiala en `iniciar.bat` (línea `ADMIN_PASSWORD`).

## Uso durante el evento

1. Entra a `/admin`, agrega cada puerta (nombre, equipo, descripción y hasta 3 fotos).
2. Cada puerta tiene su **link propio** y su **código QR** (botón ▦ QR). Imprime el QR y pégalo junto a la puerta.
3. Para que voten desde celulares en la **misma WiFi**, usa la dirección que aparece en la ventana negra como
   "Desde celulares (misma WiFi)", por ejemplo `http://192.168.1.50:3000`. Si Windows pregunta por el firewall, da "Permitir".
4. Para que voten desde **cualquier lugar por internet**, hay que publicarla (ver abajo).
5. Al terminar: apaga "Votación abierta" en el panel y descarga los resultados en CSV/Excel.
6. Después de hacer pruebas, usa **"Borrar todos los votos"** antes de abrir la votación real.

## Seguridad del voto (1 voto por dispositivo)

- Cookie firmada del dispositivo (no se puede falsificar).
- Token guardado en el navegador.
- Modo estricto: huella del dispositivo + red, para bloquear a quien intente votar otra vez en modo incógnito o borrando datos.
  Si varios celulares *idénticos* en la misma WiFi reciben "ya votaste" sin haber votado, apaga el modo estricto en el panel.
- Límite de intentos por minuto y panel protegido con contraseña.

Ningún sistema web sin cuentas es 100 % infalible (alguien con dos navegadores distintos y mucha paciencia podría intentarlo), pero esto frena al 99 % de los intentos.

## Publicarla en internet (opcional)

- **Rápido (desde tu PC):** instala `cloudflared` y ejecuta `cloudflared tunnel --url http://localhost:3000`. Te da un link público mientras tu PC esté encendida.
- **Hosting:** Render, Railway o un VPS con Node. Configura las variables `ADMIN_PASSWORD`, `PUBLIC_URL` (tu dominio) y `TRUST_PROXY=1`.
  Usa un disco persistente: los votos se guardan en `data/db.json` y las fotos en `uploads/`.

## Respaldos

Todo vive en `data/db.json` (puertas y votos) y `uploads/` (fotos). Copia esas dos carpetas para respaldar.
