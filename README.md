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

## Desplegar en Vercel

La aplicación está lista para ejecutarse en la arquitectura serverless de Vercel utilizando Upstash Redis para la base de datos y Vercel Blob para las imágenes:

1. **Importar el repositorio en Vercel**:
   - Conecta tu cuenta de GitHub y selecciona el repositorio `puertas-de-d-a-de-muertos`.
   - Vercel detectará la configuración automáticamente a través de `vercel.json`.

2. **Conectar Servicios de Storage (desde el Dashboard del proyecto en Vercel)**:
   - Ve a la pestaña **Storage** de tu proyecto.
   - Conecta **Upstash Redis** (Marketplace): esto inyectará automáticamente `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` (o `KV_REST_API_*`).
   - Conecta **Vercel Blob**: esto inyectará automáticamente `BLOB_READ_WRITE_TOKEN`.

3. **Configurar Variables de Entorno (Environment Variables)**:
   - `ADMIN_PASSWORD`: contraseña segura para el panel `/admin`.
   - `SECRET`: cadena secreta larga y aleatoria (ejemplo: un string alfanumérico o hex de 64 caracteres) para firmar cookies y tokens.
   - `TRUST_PROXY`: valor `1` (para que Express obtenga la IP real del usuario detrás del proxy de Vercel).
   - `PUBLIC_URL`: la URL pública del despliegue (ejemplo: `https://tu-proyecto.vercel.app`), necesaria para que los links y códigos QR se generen con el dominio correcto.

4. **Desplegar**:
   - Haz clic en **Deploy**. Al terminar, tu app estará en vivo con persistencia en Redis y fotos en Vercel Blob.

## Publicarla en internet (opcional)

- **Rápido (desde tu PC):** instala `cloudflared` y ejecuta `cloudflared tunnel --url http://localhost:3000`. Te da un link público mientras tu PC esté encendida.
- **Hosting:** Render, Railway o un VPS con Node. Configura las variables `ADMIN_PASSWORD`, `PUBLIC_URL` (tu dominio) y `TRUST_PROXY=1`.
  Usa un disco persistente: los votos se guardan en `data/db.json` y las fotos en `uploads/`.

## Respaldos

Todo vive en `data/db.json` (puertas y votos) y `uploads/` (fotos). Copia esas dos carpetas para respaldar.
