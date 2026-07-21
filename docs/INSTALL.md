# Instalación y despliegue

## Requisitos

- Node.js 18 o superior (probado con Node 22).
- No requiere base de datos externa: usa SQLite en un archivo local.

## Pasos

```bash
npm install
cp .env.example .env
npm run seed      # opcional: carga usuarios y pedidos de prueba
npm start         # o: npm run dev  (recarga automática)
```

La aplicación queda disponible en `http://localhost:3000` (frontend + API en el mismo puerto).

## Variables de entorno (`.env`)

| Variable | Descripción | Por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `NODE_ENV` | `development` / `production` | `development` |
| `JWT_SECRET` | **Clave para firmar tokens. Cambiar en producción.** | *(insegura)* |
| `JWT_EXPIRES` | Vida del token de acceso | `8h` |
| `SESSION_IDLE_MINUTES` | Minutos de inactividad → cierre de sesión | `30` |
| `MAX_LOGIN_ATTEMPTS` | Intentos fallidos antes de bloquear | `5` |
| `LOCK_MINUTES` | Minutos de bloqueo temporal | `15` |
| `DB_PATH` | Ruta del archivo SQLite | `./data/portal.db` |
| `UPLOAD_DIR` | Carpeta de adjuntos | `./uploads` |
| `MAX_UPLOAD_MB` | Tamaño máximo de archivo (MB) | `15` |
| `MIN_MARGIN_PCT` | Margen mínimo (%) para alertas | `20` |
| `DEFAULT_CURRENCY` | Moneda por defecto | `ARS` |
| `ODOO_ENABLED` | Activar sincronización real con Odoo | `false` |
| `ODOO_URL` | URL de la instancia Odoo | — |
| `ODOO_DB` | Nombre de la base Odoo | — |
| `ODOO_USERNAME` | Usuario/API de Odoo | — |
| `ODOO_PASSWORD` | Contraseña / API key de Odoo | — |

## Conexión con Odoo 19

La integración usa la **API externa XML-RPC** de Odoo (`/xmlrpc/2/common` y `/xmlrpc/2/object`).

1. En Odoo, crear (o reutilizar) un usuario de integración con permiso de lectura sobre
   `sale.order`, `sale.order.line`, `res.partner`, `product.product`, y de escritura sobre
   `sale.order` / `sale.order.line` para los campos que se sincronizan de vuelta.
2. Generar una **API key** para ese usuario (Ajustes → Seguridad).
3. Completar en `.env`:
   ```
   ODOO_ENABLED=true
   ODOO_URL=https://tu-odoo.com
   ODOO_DB=nombre_base
   ODOO_USERNAME=api@todoenmuebles.com
   ODOO_PASSWORD=la_api_key
   ```
4. Desde el panel **Odoo** (rol administrador) usar **“Importar pedidos desde Odoo”**.

### Campos escritos de vuelta a Odoo

- Aprobación de costo → `sale.order.line.purchase_price`.
- Estado de fabricación → campo personalizado `x_estado_fabricacion` (crear en Odoo si se desea persistir).
- Fecha estimada → `sale.order.commitment_date`.
- Recepción → campo personalizado `x_recibido`.

> Los nombres de campos personalizados (`x_...`) se pueden ajustar en `server/odoo.js` según tu
> instalación de Odoo. Mientras `ODOO_ENABLED=false`, cada push se registra en el log de
> sincronización sin contactar a Odoo, de modo que nada se pierde.

## Modo mock (sin Odoo)

Con `ODOO_ENABLED=false` (valor por defecto) la app funciona 100 % con la base local y los datos
de `npm run seed`. Es el modo recomendado para probar y demostrar.

## Producción (recomendaciones)

- Servir detrás de un proxy con **HTTPS** (nginx / Caddy).
- Definir un `JWT_SECRET` largo y aleatorio.
- Programar copias de seguridad de `data/portal.db` (+ `-wal`/`-shm`) y de `uploads/`.
- Ejecutar con un gestor de procesos (pm2, systemd) — `node server/index.js`.
