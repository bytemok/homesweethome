# Portal de Proveedores – Todo en Muebles

Aplicación web **responsive** (computadora, tablet y celular) para que los proveedores de muebles
gestionen los pedidos que Todo en Muebles les asigna, conectada por **API con Odoo 19**.

Incluye backend, base de datos, frontend, autenticación, roles y permisos, portal del proveedor,
panel administrativo, pantalla de depósito, generador de **etiquetas PDF de 100 × 80 mm** con
códigos de barras y QR, carga y aprobación de costos, cálculo de rentabilidad, calendario de
entregas, historial de auditoría y una API preparada para sincronizar con Odoo 19.

> Esta es la **primera versión (MVP funcional)**. La arquitectura está preparada para agregar las
> funciones avanzadas (WhatsApp, push, etc.) sin rehacer la aplicación.

---

## 🚀 Puesta en marcha rápida

```bash
# 1. Instalar dependencias
npm install

# 2. Crear el archivo de configuración
cp .env.example .env        # editar si hace falta (JWT_SECRET, Odoo, etc.)

# 3. Cargar datos de prueba (usuarios + pedidos de ejemplo)
npm run seed

# 4. Iniciar el servidor
npm start
```

Abrir **http://localhost:3000**

### Usuarios de prueba

| Rol         | Usuario / Email                     | Contraseña     |
|-------------|-------------------------------------|----------------|
| Administrador | `admin` · admin@todoenmuebles.com | `admin123`     |
| Proveedor 1 | `sur` · proveedor1@tapiceriadelsur.com | `proveedor123` |
| Proveedor 2 | `norte` · proveedor2@mueblesnorte.com | `proveedor123` |
| Depósito    | `deposito` · deposito@todoenmuebles.com | `deposito123`  |

---

## 🧩 Stack

- **Backend:** Node.js + Express
- **Base de datos:** SQLite (archivo local, cero configuración) vía `better-sqlite3`
- **Autenticación:** JWT + contraseñas cifradas con bcrypt
- **Etiquetas:** `pdfkit` (tamaño físico exacto) + `bwip-js` (Code 128 y QR)
- **Frontend:** SPA responsive en JavaScript puro (sin build), servida por el mismo servidor
- **Odoo 19:** cliente XML-RPC propio (`server/odoo.js`) con sincronización bidireccional

No requiere paso de compilación ni dependencias externas de red para funcionar.

---

## 👥 Roles y permisos

- **Administrador de Todo en Muebles** — ve todos los proveedores y pedidos, asigna pedidos,
  aprueba/rechaza costos, ve precio de venta, costos, ganancia y rentabilidad, estadísticas,
  administra usuarios, revisa auditoría y recibe notificaciones.
- **Proveedor** — ve **únicamente** sus pedidos asignados; confirma, carga costos, fechas,
  estados, comentarios, imprime etiquetas y adjunta documentación.
  **Nunca** ve precio de venta ni rentabilidad, ni pedidos de otros proveedores.
- **Depósito** — escanea etiquetas, confirma recepción, informa faltantes/daños, adjunta fotos.

El aislamiento por proveedor se aplica en **el backend** (no sólo en la interfaz): cualquier
intento de acceder a un pedido ajeno responde `404`, y los datos financieros se eliminan de la
respuesta antes de enviarla a un proveedor.

---

## 📦 Funcionalidades del MVP

1. Inicio de sesión seguro (bloqueo por intentos, cierre por inactividad, recuperación, último acceso).
2. Roles y permisos con scoping por proveedor.
3. Importación de pedidos desde Odoo (o datos de prueba en modo mock).
4. Vista de pedidos por proveedor, con tarjetas, filtros y buscador.
5. Detalle completo de productos (todos los campos de fabricación).
6. **Patas, adicionales y observaciones destacados** en pantalla y en la etiqueta.
7. Carga de costos con desglose + **flujo de aprobación** e historial.
8. Fecha estimada de entrega + calendario + entregas parciales.
9. 16 estados de fabricación + porcentaje de avance + gestión de demoras.
10. **Etiqueta PDF 100 × 80 mm** (Zebra ZD220), sin márgenes.
11. Código de barras Code 128 de orden y de producto + **QR** al pedido.
12. Panel de rentabilidad (solo administración) con alertas.
13. Recepción en depósito mediante escaneo.
14. Historial de cambios / auditoría completo.

---

## 🗂️ Estructura

```
server/
  index.js            Punto de entrada Express + estáticos
  config.js           Configuración desde .env
  db.js               Esquema SQLite completo
  seed.js             Datos de prueba
  auth.js             Login, JWT, bcrypt, bloqueos, middleware de rol
  helpers.js          Auditoría, notificaciones, logs de sync
  constants.js        Estados, etiquetas, resultados de recepción
  labels.js           Generación de etiquetas PDF 100×80 mm
  odoo.js             Cliente XML-RPC de Odoo 19 + sincronización
  orderView.js        Ensamblado de pedidos + rentabilidad
  routes/             auth, orders, costs, deliveries, reception,
                      labels, files, social, dashboard, admin, sync
public/               Frontend SPA (index.html, css, js)
docs/
  API.md              Documentación de endpoints
  INSTALL.md          Instalación y despliegue
data/                 Base SQLite (generada)
uploads/              Archivos adjuntos (generado)
```

---

## 🔌 Integración con Odoo 19

Ver **[docs/INSTALL.md](docs/INSTALL.md)** para configurar la conexión. Con `ODOO_ENABLED=false`
la aplicación trabaja con datos locales de prueba y **simula** los envíos a Odoo registrándolos en
el log de sincronización, para poder desarrollar y demostrar sin una instancia real.

Con `ODOO_ENABLED=true` y credenciales válidas:

- **Pull:** importa órdenes de venta confirmadas, líneas, clientes y productos.
- **Push:** al aprobar un costo, cambiar un estado o una fecha, escribe de vuelta en Odoo.

Evita duplicados mediante `odoo_id` en cada entidad (orden, línea, cliente, proveedor…).

---

## 🔐 Seguridad y auditoría

- Contraseñas cifradas (bcrypt), tokens firmados (JWT) con expiración.
- Bloqueo temporal por intentos fallidos y bloqueo manual de usuarios.
- Cierre automático de sesión por inactividad.
- Control de acceso por rol **y** por proveedor en cada endpoint.
- Registro de auditoría (usuario, fecha, campo, valor anterior/nuevo, IP, dispositivo).
- Los comentarios no se borran definitivamente (soft delete + auditoría).
- Formatos de archivo validados (PDF, JPG, JPEG, PNG, WEBP) y límite de tamaño.

Para producción: cambiar `JWT_SECRET`, servir por HTTPS y realizar copias de seguridad del
archivo `data/portal.db` y de la carpeta `uploads/`.

---

## 📄 Documentación

- **[docs/API.md](docs/API.md)** — endpoints de la API.
- **[docs/INSTALL.md](docs/INSTALL.md)** — instalación, variables de entorno y conexión con Odoo.
