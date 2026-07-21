# Documentación de la API

Base: `/api`. Todas las respuestas son JSON salvo las etiquetas y descargas (PDF / binario).
La autenticación es por **Bearer token** (JWT) en el header `Authorization: Bearer <token>`,
salvo los endpoints de login/recuperación.

Roles: `admin`, `proveedor`, `deposito`. El aislamiento por proveedor se aplica en el servidor.

---

## Autenticación — `/api/auth`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/login` | público | `{ identifier, password }` → `{ user, token, idleMinutes }` |
| GET  | `/me` | autenticado | Usuario actual + proveedor vinculado |
| POST | `/change-password` | autenticado | `{ current, next }` |
| POST | `/forgot` | público | `{ email }` → genera token de recuperación |
| POST | `/reset` | público | `{ token, password }` |

## Pedidos — `/api/orders`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | todos | Lista con scoping. Filtros: `q, client, product, from, to, status, confirmation, delayed, no_cost, no_date, urgent, eta` |
| GET | `/:id` | todos* | Detalle completo. Oculta venta/rentabilidad si no es admin |
| POST | `/:id/confirm` | proveedor/admin | `{ response, note }` (recibido/confirmado/aclaracion/no_puedo/rechazado) |
| POST | `/lines/:lineId/state` | proveedor/admin | `{ state, progress, delay_reason?, new_eta?, qty_done? }` |
| POST | `/:id/assign` | admin | `{ supplier_id }` |
| POST | `/:id/general` | admin | `{ general_notes?, priority? }` |

\* El proveedor sólo accede a pedidos de su proveedor (si no, `404`).

## Costos — `/api/costs`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/line/:lineId` | proveedor/admin | Carga/actualiza costo (vuelve a `pendiente`). Calcula el total |
| POST | `/:costId/decision` | admin | `{ decision }` = `aprobado`/`rechazado`/`revision`. Al aprobar, sincroniza con Odoo |
| GET | `/line/:lineId/history` | proveedor/admin | Historial de costos |
| GET | `/pending` | admin | Costos pendientes de aprobación |

## Entregas — `/api/deliveries`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/:orderId` | proveedor/admin | Fechas de entrega (estimada, nueva, franja, despacho, real, tipo…) |
| POST | `/partial/:lineId` | proveedor/admin/deposito | Entrega parcial |
| GET | `/calendar` | todos | Calendario de entregas (con alertas de vencidas/próximas/mismo día) |

## Recepción (depósito) — `/api/reception`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/scan?code=` | deposito/admin | Busca por nº de orden, código de producto o QR (`ORDER:<id>` / `LINE:<id>`) |
| POST | `/` | deposito/admin | `{ line_id, result, qty_received, notes }`. Genera incidencia si corresponde |

## Etiquetas — `/api/labels` (devuelven PDF 100 × 80 mm)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/order/:orderId?mode=order\|unit\|package` | Etiquetas de un pedido (por producto / por unidad / por bulto) |
| GET | `/line/:lineId` | Una etiqueta de una línea |
| GET | `/multi?orders=1,2,3` | Etiquetas de varios pedidos |

## Archivos — `/api/files`

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/:orderId` | multipart `file`, `kind`, `line_id?` (PDF/JPG/PNG/WEBP) |
| GET | `/:orderId` | Lista de adjuntos |
| GET | `/download/:id` | Descarga (respeta permisos) |

## Comunicación y notificaciones — `/api/social`

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/comments/:orderId` | Chat del pedido (el proveedor no ve mensajes internos) |
| POST | `/comments/:orderId` | `{ body, internal? }` (internal solo admin) |
| DELETE | `/comments/:id` | Soft delete (se conserva en auditoría) |
| GET | `/notifications` | `{ notifications, unread }` |
| POST | `/notifications/read` | Marca todas como leídas |

## Tableros — `/api/dashboard`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/cards` | todos | Tarjetas del panel + próximas entregas (con scoping) |
| GET | `/admin` | admin | Totales, rentabilidad por proveedor/vendedor/modelo |
| GET | `/suppliers-ranking` | admin | Ranking de proveedores |

## Administración — `/api/admin` (solo admin)

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST/PATCH | `/users` … | Gestión de usuarios |
| POST | `/users/:id/block` | Bloquear/activar |
| GET/POST | `/suppliers` | Gestión de proveedores |
| GET | `/audit` | Historial de auditoría (`?order_id`, `?entity`, `?limit`) |
| GET | `/sync-logs` | Registros de sincronización |

## Sincronización Odoo — `/api/sync` (solo admin)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/pull` | Importa órdenes desde Odoo |
| GET | `/status` | Estado de la integración |
| GET | `/errors` | Errores de sincronización (para reintentar) |

## Metadatos — `/api/meta`

Devuelve estados, etiquetas de estados, respuestas de confirmación y resultados de recepción,
para que el frontend muestre los textos correctos.
