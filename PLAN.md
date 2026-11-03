# FabriHub: plan de implementación

Implementación web de la tesis *"Diseño de un Sistema de Información de apoyo al sector de la PYME
venezolana: Sistema de Planificación y Control de la Producción e Inventarios"* (G. Palma, UCAB),
con caso de referencia Laboratorios COFASA (farmacéutica). Se construye con la misma arquitectura,
las mismas convenciones y el mismo modelo de seguridad que **DaviHub**.

> El nombre es **FabriHub** ("Fabricación" + "Hub", el sufijo de la familia DaviHub).

---

## 1. Arquitectura

La tesis pide **cliente/servidor a tres niveles** (servicios de usuario, empresariales y de datos;
cap. 2.3.5 y 3.2). Se respeta al pie de la letra:

```
 Navegador
    │  https://fabrihub  (un solo origen)
    ▼
┌──────────────────────────┐   Servicios de usuario
│ front  (Express+Vite SPA)│   = davihub-front: server.ts sirve dist/ y hace proxy /api
└───────────┬──────────────┘
            │ /api/*  (red_app)
            ▼
┌──────────────────────────┐   Servicios empresariales
│ api   (Node 22 + TS)     │   handlers por módulo/acción (equivalente a las lambdas de davihub)
└───────────┬──────────────┘
            │ SQL parametrizado (red_datos, internal: sin internet)
            ▼
┌──────────────────────────┐   Servicios de datos
│ db    (PostgreSQL 16)    │   reglas críticas en funciones/triggers (stock, costo, BOM)
└──────────────────────────┘
   + mailpit (OTP/alertas)  + backup (pg_dump diario)  + pgadmin (perfil tools)
```

**Por qué no LocalStack/Lambdas como DaviHub:** para una tesis/PYME el costo operativo de AWS no se
justifica (la propia tesis lo plantea en 1.1). Se mantiene **la forma** de DaviHub: cada endpoint
es un *handler* aislado, igual que una lambda, de modo que migrar a Lambda después sea mover carpetas.

## 2. Stack (calcado de DaviHub)

| Capa | Tecnología |
|---|---|
| Front | React 19, Vite 7, TypeScript, **Mantine 8**, Tailwind 4, Tabler Icons, React Router 7, TanStack Query + Table, Zustand (persist cifrado AES con crypto-js), zod, dayjs, xlsx, recharts / @mantine/charts |
| Servidor del front | Express 5 + http-proxy-middleware (`server.ts` → `server.mjs` con esbuild) |
| API | Node 22, TypeScript, Express 5, `pg` (sin ORM, SQL explícito), zod, bcrypt, jsonwebtoken, helmet, express-rate-limit, nodemailer, pino |
| BD | PostgreSQL 16, scripts numerados `00001_*.sql` como `davihub-core-db` |
| Pruebas | Jest + Testing Library (front), Jest + supertest contra una BD de prueba (api) |

## 3. Módulos (subsistemas de la tesis → `catalogs_modules.code`)

Cada sub-módulo es una pantalla con su propia ruta y sus propios permisos, igual que en DaviHub.

| Subsistema (cap. 4.2.2.1) | Módulo raíz | Sub-módulos (code) |
|---|---|---|
| Tablero | `DASHBOARD` | KPIs, alertas, accesos a módulos |
| Inventario | `INVENTORY` | `INV_PRODUCTS`, `INV_CATALOGS` (tipo/familia/categoría/unidades), `INV_WAREHOUSES`, `INV_LOTS`, `INV_MOVEMENTS`, `INV_STOCK` (existencias/kardex) |
| Planificación y Control | `PRODUCTION` | `PRD_STAGES`, `PRD_ROUTES`, `PRD_FORMULAS` (BOM + explosión/implosión), `PRD_CENTERS` (producción y trabajo), `PRD_PLANNING` (plan de ventas → MPS → MRP), `PRD_ORDERS`, `PRD_TRACKING` (procesos/tiempos) |
| Compras | `PURCHASES` | `PUR_SUPPLIERS`, `PUR_BUYERS`, `PUR_PRICE_LISTS`, `PUR_ORDERS`, `PUR_RECEPTIONS` |
| Ventas | `SALES` | `SAL_CUSTOMERS`, `SAL_SELLERS`, `SAL_PRICE_LISTS`, `SAL_ORDERS`, `SAL_DELIVERY_NOTES` |
| Calidad (nuevo, exigido por el caso farmacéutico) | `QUALITY` | `QC_LOTS` (cuarentena → aprobado/rechazado) |
| Impuestos | `TAXES` | `TAX_TAXES`, `TAX_WITHHOLDINGS`, `TAX_TREATMENTS` |
| Parámetros del sistema | `SETTINGS` | `SET_COMPANY`, `SET_PARAMETERS`, `SET_COMMERCIAL` (condición de pago/entrega, método de entrega, zona, tipo de negocio, moneda) |
| Seguridad (nuevo) | `ADMIN` | `ADM_USERS`, `ADM_ROLES`, `ADM_MODULES`, `ADM_AUDIT`, `ADM_METRICS` |

`ProtectedModuleRoute`, el sidebar y las tarjetas del tablero se alimentan de este catálogo. Con
`is_offline` se pone un módulo en mantenimiento y con `is_show_dev/qa/prod` se oculta por entorno,
exactamente como en DaviHub.

## 4. Base de datos

### 4.1 Convenciones (las de `davihub-core-db`)

- Tablas en inglés y snake_case; catálogos con prefijo `catalogs_`.
- PK `id UUID DEFAULT gen_random_uuid()`, además de un `code VARCHAR UNIQUE` de negocio (el "Código
  de…" de la tesis).
- Columnas comunes: `is_active`, `order_list`, `metadata JSONB`, `created_at`, `updated_at`,
  `created_by`, `updated_by`.
- `COMMENT ON TABLE/COLUMN` en todas las columnas, porque la defensa se apoya en el diccionario de datos.
- Un archivo por tabla en `db/init/`, con numeración por bloque.

### 4.2 Mapa de archivos

| Bloque | Archivos (resumen) |
|---|---|
| `00000` | extensiones |
| `000xx` catálogos | `catalogs_permissions`, `catalogs_roles`, `catalogs_modules`, `catalogs_units`, `catalogs_currencies`, `catalogs_product_types`, `catalogs_product_families`, `catalogs_product_categories`, `catalogs_zones`, `catalogs_business_types`, `catalogs_payment_terms`, `catalogs_delivery_terms`, `catalogs_delivery_methods`, `catalogs_order_types`, `catalogs_order_statuses`, `catalogs_movement_types`, `catalogs_movement_concepts`, `catalogs_work_center_types` |
| `001xx` seguridad | `users`, `users_modules`, `users_warehouses`, `users_sessions`, `users_auth_history`, `users_passwords_history`, `users_otp`, `trace_api_logs`, `audit_log`, `metrics_module_usage`, `notifications` |
| `002xx` empresa/parámetros | `company`, `parameters`, `document_sequences` (correlativos de OC/OV/OP/NE) |
| `003xx` impuestos | `taxes`, `taxes_rates`, `withholdings`, `withholdings_brackets`, `fiscal_treatments` |
| `004xx` inventario | `products`, `products_relations` (sustituto/complementario/equivalente), `warehouses`, `lots`, `stock_balances`, `stock_policies` (mín/máx), `inventory_movements`, `inventory_movements_details` |
| `005xx` producción | `stages`, `routes`, `routes_data` (tiempos teóricos), `formulas` (BOM), `production_centers`, `production_centers_stages`, `work_centers`, `production_centers_work_centers`, `periods`, `plans`, `production_orders`, `production_orders_details`, `production_processes` |
| `006xx` compras | `buyers`, `suppliers`, `suppliers_contacts`, `price_lists`, `price_lists_items`, `purchase_orders`, `purchase_orders_details`, `receptions` |
| `007xx` ventas | `sellers`, `customers`, `customers_contacts`, `sales_orders`, `sales_orders_details`, `delivery_notes` |
| `008xx` lógica | funciones y triggers (sección 5) |
| `009xx` seeds | permisos, roles, módulos, admin, IVA 16 %, catálogos y datos demo COFASA |
| `99999` | rol de la aplicación (ya creado) |

### 4.3 Correcciones al diseño de la tesis (para la defensa)

1. **Planificación Enero…Diciembre** se convierte en filas `plans(period_id, product_id, plan_type, month, qty)`:
   permite horizontes semanales y consultas sin `CASE`.
2. **DetalleParametros 1…10** pasa a clave/valor tipado en `parameters`.
3. **Tarifa de Retención 1…4** pasa a tramos en `withholdings_brackets` (base, sustraendo, %), sin límite de tramos.
4. **Teléfono/Fax 1…3** pasa a `JSONB` de contactos.
5. **Cantidad Total del producto** deja de almacenarse y se calcula desde `stock_balances` (eliminar la
   redundancia evita descuadres).
6. **Productos en Almacenes** se separa en `stock_balances` (almacén+producto+lote) y `stock_policies` (mín/máx por almacén).
7. **Cardinalidades:** se corrige la relación Concepto ↔ Tipo de movimiento, que en 4.2.2.2.1 está
   invertida: un tipo tiene muchos conceptos. También la de Fórmula ↔ Producto: una fórmula tiene
   N componentes y una ruta.
8. **Movimientos inmutables:** el `Delete` de movimientos se reemplaza por un **movimiento de reverso**.
   Es lo que exige la trazabilidad GMP de un laboratorio.

## 5. Reglas de negocio (los métodos de las clases de la tesis)

| Método en la tesis | Dónde vive | Cómo |
|---|---|---|
| Entrada/Salida del Almacén, Calcular Costos | BD: `fn_post_movement()` | Al contabilizar un movimiento: actualiza `stock_balances` con bloqueo de fila, recalcula el **costo promedio ponderado**, impide saldo negativo cuando el tipo tiene `validates_exit` e impide sacar lotes que no estén `APPROVED` |
| Load Explosión / Implosión | BD: `fn_bom_explode(product, qty)` / `fn_bom_implode(component)` | CTE recursivo multinivel con detección de ciclos |
| Verificar Existencia (Fórmula) | API → `fn_bom_explode` + disponibles | Devuelve faltantes por componente, marcando los `is_critical` |
| Planificación.Calcular (MRP) | BD: `fn_mrp_net_requirements(period)` | Plan de ventas → MPS → explosión → neto = bruto − disponible − en tránsito (OC abiertas) → sugiere **OP** (fabricado) u **OC** (comprado) |
| Orden de Producción: ciclo 2.1.4 | API (máquina de estados) | `PLANNED → CREATED → RELEASED → IN_PROCESS → CONFIRMED → CLOSED`. Liberar verifica disponibilidad y **reserva** (`assigned`); el consumo genera salidas; la confirmación genera la entrada del terminado en un lote nuevo en **cuarentena**; el cierre calcula el costo real (material + mano de obra + costo fabril por etapa) y su variación contra el estándar |
| Recepción.Recibir | API + BD | Recepción parcial o total → lote nuevo (cuarentena) → movimiento de entrada → costo promedio → estado de la OC (`PENDING/BACKORDER/RECEIVED`) |
| Nota de Entrega | API + BD | Selección de lotes **FEFO** (vence primero, sale primero) → salida → estado de la OV |
| Tratamiento fiscal | API: `taxEngine` | IVA por producto/cliente/proveedor, retención de IVA 75/100 % y retención ISLR por tramos |
| Alarmas (justificación, 1.2) | Job cada hora en la API | Stock bajo el mínimo, lotes por vencer, OC vencidas y OP atrasadas → `notifications` (campana) y correo |

## 6. Seguridad por niveles (el modelo de DaviHub)

| Nivel | Qué se implementa |
|---|---|
| **1. Identidad** | Login con email + contraseña (bcrypt, costo 12). Política: 10 caracteres o más, con mayúscula, número y símbolo. **Cambio obligatorio** en el primer ingreso. `users_passwords_history`: no se puede reutilizar ninguna de las últimas 5 |
| **2. Segundo factor** | **OTP de 6 dígitos por correo** (pantalla `otp-verify` como en DaviHub). Se guarda hasheado, vence a los 5 min y admite 3 intentos |
| **3. Sesión** | JWT de acceso de 15 min. Refresh de 8 h **rotativo**, guardado hasheado en `users_sessions` y entregado en cookie `httpOnly; SameSite=Strict`, con revocación por sesión o "cerrar todas". `useCheckToken`/`useTokenExpiry` y logout por inactividad (30 min) en el front. Store Zustand persistido con AES (`Storage.ts`) |
| **4. Fuerza bruta** | 5 intentos fallidos bloquean la cuenta 15 min. Rate-limit en `/auth/*` por IP. Todo queda en `users_auth_history` (IP, user-agent, trace_id) |
| **5. Autorización por módulo (RBAC)** | `catalogs_permissions` (slugs `access, view, view_all, add_new, edit, delete, download, import, approve, release, close, configure`), `catalogs_roles.permissions` y `users_modules(role_ids[], permissions[])`. **Permisos efectivos = unión de los roles + extras**, resueltos en el login como en DaviHub. Front: `useCanAccess`, `useCan(code)("slug")`, `<Can>`, `ProtectedRoute`, `ProtectedModuleRoute`. **API: `requirePermission('PUR_ORDERS','approve')` en cada handler.** El front sólo oculta; quien autoriza es la API |
| **6. Alcance de datos** | `users_warehouses`: un almacenista sólo ve y mueve sus almacenes. `view` muestra lo propio y `view_all` todo, como en DaviHub |
| **7. Segregación de funciones** | Quien crea una OC no puede aprobarla. Quien registra un lote no puede liberarlo de calidad. Liberar una OP exige `release` y cerrarla exige `close` |
| **8. Auditoría** | `trace_id` por request (`x-trace-id`) registrado en `trace_api_logs`. Un trigger genérico `audit_log` (old/new JSONB) en las tablas de negocio: la API hace `set_config('app.user_id', …)` en cada transacción, así el trigger sabe quién hizo el cambio. La app no puede hacer UPDATE ni DELETE sobre la auditoría (ya está en `99999_app_role.sh`). `metrics_module_usage` registra las visitas |
| **9. Aplicación** | zod en toda entrada, SQL siempre parametrizado, helmet + CSP, CORS de mismo origen, errores sin stack hacia el cliente |
| **10. Infraestructura** | Contenedores `read_only`, `cap_drop: ALL` y `no-new-privileges`. La BD sólo vive en la red `internal` y la API **no usa el superusuario** (rol DML). Respaldos diarios con retención 7d/4s/6m. pgAdmin sólo en 127.0.0.1 |

**Roles semilla:** `ADMIN`, `PLANNER` (planificador), `PROD_SUPERVISOR`, `WAREHOUSE` (almacenista),
`QUALITY`, `BUYER`, `SELLER`, `VIEWER` (consulta). Cada uno se asigna **por módulo**, como en DaviHub.

## 7. Front (estructura y estilo DaviHub)

```
front/src/
  app/
    auth/        sign-in, otp-verify, change-password, forgot/reset-password, logout, store/coreAuth
    dashboard/   Page + config-nav-modules.ts (tarjetas por módulo)
    inventory/   products/, warehouses/, lots/, movements/, stock/
    production/  stages/, routes/, formulas/, centers/, planning/, orders/, tracking/
    purchases/   suppliers/, orders/, receptions/, price-lists/
    sales/       customers/, orders/, delivery-notes/, price-lists/
    quality/  taxes/  settings/  admin/
      <pantalla>/Page.tsx, hooks/, pipe/steps/, validators/, __tests__/
  global/
    atoms/       buttons (BtnCrudAdd/Save/Close, BtnExportExcel, BtnSearch…), tables (TbEmpty, TbLoader…),
                 layouts (ModuleHeader, ModulesSidebar, ModuleNoAccess), StatCard, states (ModuleOffline)
    modules/     access-control (useCan, useCanAccess, Can), check-token, metrics
    clients/     apiClient.ts (fetch + refresh automático + x-trace-id)
    pipeline/    Pipeline.ts (mismo patrón pipe/steps)
    store/       Storage.ts (persist cifrado), purgePersistedStores.ts
    assets/      theme.ts, theme/colors.ts, index.css
  layouts/       AuthLayout, DashboardLayout
  navigation/    AppRouter, ProtectedRoute, ProtectedModuleRoute, routes.config.ts
```

**Estilo:** el mismo de DaviHub. Montserrat, `defaultRadius: "md"`, fondo `gray-50`, header superior
con avatar, campana de notificaciones y versión, sidebar de módulos, tablero de tarjetas, tablas
TanStack con contadores y exportación a Excel, modales Mantine para CRUD. Lo único que cambia es la
**paleta**: FabriHub usa un **azul petróleo industrial** (10 tonos en `colors.ts`) en lugar del rojo
Davivienda, para que no se confunda con el producto del banco. Pasarlo a rojo es cambiar
`primaryColor`.

> Se replican **patrones**, no se copia código ni marca de DaviHub. Es código corporativo, y la
> tesis debe ser obra propia.

## 8. Plan por fases

| Fase | Entregable | Resultado demostrable |
|---|---|---|
| **0. Base** | `api/` y `front/` con Dockerfiles. `docker compose up` levanta todo. Health checks | Login vacío navegable |
| **1. Seguridad** | Tablas `001xx`, auth completa (login, OTP, refresh, cambio de contraseña, bloqueo), RBAC, guards, admin de usuarios/roles/módulos, auditoría | Entrar con OTP y ver sólo los módulos asignados |
| **2. Parámetros + Impuestos** | Catálogos `000xx`, `002xx`, `003xx` y sus CRUD | Configurar empresa, IVA y retenciones |
| **3. Inventario** | Productos, almacenes, lotes, motor de movimientos, kardex, costo promedio | Entradas/salidas con existencias y costo correctos |
| **4. Compras** | Proveedores, listas de precio, OC, recepción con lotes en cuarentena, módulo Calidad | Ciclo OC → recepción → aprobación QC → stock disponible |
| **5. Producción** | Etapas, rutas, centros, fórmulas con explosión/implosión, OP con su ciclo completo, seguimiento de tiempos, costeo | Fabricar un lote de un medicamento COFASA de punta a punta |
| **6. Ventas** | Clientes, OV, nota de entrega FEFO, impuestos en documento | Vender el lote fabricado |
| **7. Planificación** | Plan de ventas → MPS → MRP con sugerencias convertibles en OP/OC | El caso completo de los gráficos 1–3 de la tesis |
| **8. Tablero y alertas** | KPIs, alarmas, reportes Excel | Demo final de la defensa |

Las fases 3 a 5 son el corazón de la tesis ("el control de inventario es el corazón de las
actividades de manufactura", 4.2.1). Si el tiempo aprieta, la fase 7 puede hacer el MRP en un solo nivel.

## 9. Trazabilidad con los objetivos de la tesis

| Objetivo específico | Evidencia en FabriHub |
|---|---|
| Documentar procesos de producción e inventarios | Máquinas de estado de OP/OC/OV + este documento |
| Identificar requerimientos del sistema de manufactura | Catálogo de módulos y permisos (sección 3 y 6) |
| Analizar el sistema actual de COFASA (SM4/FoxPro) | Seeds con datos demo COFASA y correcciones del modelo (4.3) |
| Determinar la arquitectura | 3 niveles en contenedores (sección 1) |

## 10. Estado actual

- **Fases 0 a 8 terminadas** (ver README.md). Verificadas con `scripts/smoke.sh` (330/330). Las fases 0 a 7 se probaron además en el navegador.
- Fase 2: los catálogos comerciales quedaron en `00200–00201` (no en 000xx), porque dependen de `users`
  y de `fn_audit()`. Los tipos y estados de orden se crearán en las fases 4 y 6, junto con sus
  máquinas de estado. Las listas de precios pasan a Compras y Ventas.
- Diferencias con lo planeado en las secciones anteriores:
  - Los catálogos de seguridad quedaron en `00010–00012` y las tablas de seguridad en `00100–00108`.
  - `users_warehouses` (alcance por almacén) pasa a la fase 3, cuando exista `warehouses`.
  - Las pruebas del front usan Vitest (en vez de Jest), porque comparte la configuración de Vite.
  - El access token vive solo en memoria y se recupera con la cookie httpOnly al recargar. Es una
    mejora sobre DaviHub, que persiste el token cifrado en localStorage.
- Fase 3:
  - Desde aquí el esquema evoluciona con **migraciones** (`db/migrations` y el servicio `migrate`).
  - El motor de existencias corre como `SECURITY DEFINER`: la app no puede escribir saldos directamente.
  - Aprobar o rechazar lotes en cuarentena queda para Calidad (fase 4).
  - La explosión e implosión de materiales se implementa con las fórmulas (fase 5).
- Fase 4:
  - Las listas de precios usan un factory común (`priceListRoutes(scope)`) que reutilizará Ventas.
  - El costo de la recepción es neto × tasa ÷ factor de unidad; anular una recepción reversa su movimiento.
  - Los lotes recibidos nacen en cuarentena; `lots_quality_events` es inmutable.
- Fase 5:
  - Un centro de trabajo pertenece a un centro de producción (FK directa en vez de la tabla puente).
  - `formulas` + `formulas_details` (cabecera con versión, cantidad base y ruta). La merma se suma: qty × (1 + merma %).
  - `stock_reservations` es genérica: la reutilizará Ventas (fase 6) para reservar en las órdenes de venta.
  - Cada material se consume del almacén de materiales si alcanza; si no, del almacén con más disponible.
  - El costo estándar se fija al liberar; la variación compara el real con el estándar de lo fabricado.
- Fase 6:
  - La retención en ventas la aplica el CLIENTE (agente de retención): `customers.is_withholding_agent`.
  - Exposición de crédito = total de órdenes abiertas (sin cuentas por cobrar todavía) en moneda base.
  - Las reservas de venta usan `stock_reservations` (fase 5) con `source_module = 'SALES'`.
  - Devoluciones de clientes (DEV_CLIENTE) quedan fuera: la anulación de la nota reversa el despacho.
  - La pantalla de listas de precios es un solo componente (`app/pricing/PriceListsView`) para Compras y Ventas.
- Fase 7:
  - El MRP vive en la API (`modules/planning/mrp.ts`), no en una función SQL: es más legible para la defensa
    y guarda cada corrida (`mrp_runs`, `mrp_results`, `mrp_suggestions`).
  - Cubetas mensuales; el MPS ES la orden planificada de los terminados (no se vuelve a netear).
  - La fecha de necesidad de un componente es el lanzamiento de su orden padre.
  - `products.lead_time_days` es el tiempo de reposición.
  - Se agregaron fórmulas de Ibuprofeno y Vitamina C (con sus insumos) para explotar todo el plan.
  - Pedidos de venta pendientes no se suman como demanda: la demanda independiente es el plan de ventas.
- Fase 8:
  - Las pantallas del Tablero son hojas de `DASHBOARD`: `DSH_INDICATORS`, `DSH_ALERTS` (`configure` = revisar ahora)
    y `DSH_REPORTS` (`download`). El inicio y la campana siguen siendo de todos.
  - Dentro de cada pantalla se exige además `view` en el módulo de origen, con su alcance; una sola regla SQL
    (`alertVisibleTo`) decide quién ve una alerta y quién recibe su aviso.
  - El detector vive en la API (no en un job de la BD): `alerts` (una fila por situación, con clave estable),
    `alerts_runs` (bitácora) y `notifications` (campana). Solo una alerta NUEVA notifica y envía correo.
  - El Excel se arma en el servidor, no con `xlsx` en el navegador: el permiso y el alcance no se pueden saltar.
  - Parámetros nuevos en Parámetros → Tablero: detector activo, frecuencia, correo, días de cuarentena y retención.
- Todas las fases del plan original están completas.

### 10.1 Ampliación: multiempresa, logos, imagen de producto y punto de venta

| Fase | Entregable | Estado |
|---|---|---|
| **9. Multiempresa: BD** | `companies`, `users_companies`, `company_id` + RLS en las tablas de negocio, FK compuestas, únicos por empresa; la API fija la empresa activa | Terminada |
| **10. Multiempresa: API y front** | Cambio de empresa, administración de empresas (plataforma / empresa), selector en el front, plantilla de empresa nueva | Terminada |
| **11. Archivos + imagen de producto** | Servicio de archivos, `products.image_file_id` y `barcode` | Terminada |
| **12. Identidad por empresa** | Logo en el sitio, Excel, PDF y correos | Terminada |
| **13. Punto de venta: backend** | Cajas, turnos con arqueo, venta en una transacción (precio/IVA, FEFO, pagos combinados, IGTF), supervisor, anulación, comprobante PDF | Terminada |
| **14. Punto de venta: pantalla** | Pantalla de venta con fotos, lector de código de barras y ticket en vivo; turnos y comprobantes | Terminada |

- Fase 9 (migración `20261028_0901_multicompany`):
  - Una BD compartida. Cada tabla de negocio lleva `company_id NOT NULL DEFAULT fn_current_company()` y una
    política RLS `p_company_isolation`. La API fija `app.company_id`: `withTx` en la transacción y `query()`
    sobre el pool en la conexión (AsyncLocalStorage, `runInCompany`). Sin empresa, RLS no devuelve nada.
  - Son **globales** (sin `company_id`): seguridad (usuarios, sesiones, roles, módulos, permisos), bitácoras,
    monedas, unidades, tipos de producto, tipos y conceptos de movimiento, impuestos, retenciones y
    tratamientos fiscales. El código depende de sus códigos; en la fase 10 solo los edita el administrador de plataforma.
  - Las FK entre tablas de empresa son compuestas `(company_id, x) → (company_id, id)`: las FK ignoran RLS,
    así que esto es lo que impide referenciar datos de otra empresa. `ON DELETE SET NULL (x)` anula solo la columna.
  - Los únicos naturales (código, RIF, número) pasan a `(company_id, …)`. Los que ya incluyen una FK de empresa
    (p. ej. `(warehouse_id, product_id)`) quedan igual. Los `ON CONFLICT` sobre ellos deben nombrar `company_id`.
  - Las funciones `SECURITY DEFINER` y las que pueden correr dentro de ellas filtran la empresa a mano:
    `fn_parameter` y `fn_next_document_number`. `fn_post/reverse_inventory_movement` son ahora envoltorios
    que validan la empresa y llaman al núcleo `fn__post/reverse_inventory_movement` (vedado a la app).
  - Las vistas usan `security_invoker`: si no, correrían como su dueño, sin RLS.
  - Los permisos son por empresa (`users_modules.company_id`). La sesión guarda su empresa activa
    (`users_sessions.company_id`), que es la de por defecto del usuario. El admin inicial pertenece a todas las empresas.
  - Administración de usuarios y auditoría: solo los miembros y registros de la empresa activa.
  - El detector de alertas recorre las empresas activas, cada una con su frecuencia.
  - `scripts/smoke/tenant-isolation.sql` (lo corre `smoke.sh`) prueba el aislamiento en la BD con el rol de la app.
- Fase 10 (migración `20261029_1001_multicompany_admin`):
  - Dos niveles de administración. `users.is_platform_admin` (el admin inicial) crea, edita y suspende empresas y
    gestiona sus miembros (módulo `ADM_COMPANIES`, Seguridad → Empresas). Cada empresa tiene sus propios
    administradores, que gestionan usuarios y permisos solo dentro de ella.
  - `catalogs_modules.scope`: `platform` (Empresas, Roles, Módulos) no se muestra ni se asigna fuera de la plataforma;
    `global` (impuestos, retenciones, tratamientos) deja a los demás solo `access/view/view_all/download`.
    Los catálogos globales del motor (monedas, unidades, tipos de producto, conceptos) responden 403 `PLATFORM_ONLY`
    al escribir; el front los muestra en solo lectura (`useCanGlobal`).
  - Empresa nueva: `fn_company_init` copia de la empresa plantilla (por defecto la activa) los parámetros, la numeración
    (desde 1) y los catálogos comerciales y de producción. Quien la crea queda como miembro administrador; opcionalmente
    se indica otro administrador (si no existe se crea y recibe una contraseña temporal).
  - Alta de usuario con un correo que ya existe en otra empresa: se agrega como miembro (`addedExisting`), con su
    contraseña actual. "Quitar de la empresa" retira pertenencia, módulos y almacenes solo en la empresa activa.
  - Cambio de empresa: `GET /auth/companies`, `POST /auth/switch-company` (opción "abrir siempre en esta"). La empresa
    vive en la sesión; el front envía `x-company-id` y, si otra pestaña cambió de empresa, la API responde
    409 `COMPANY_CHANGED` y la página se recarga. Si la empresa de la sesión se suspende o el usuario es retirado,
    la sesión pasa sola a otra de sus empresas (o 403 `NO_COMPANY`).
  - Selector de empresa en la cabecera; tras cambiar se recarga la app para descartar cachés.
  - `scripts/smoke/companies.mjs` cubre empresas, cambio, alcance de módulos, miembros y suspensión.
- Fase 11 (migración `20261030_1101_files_product_image`):
  - `files` (por empresa, RLS) guarda los metadatos; el contenido va al almacenamiento (`api/src/lib/storage.ts`):
    hoy el volumen `uploads` (`/data/uploads`). Un bucket S3/R2 sería otro driver con la misma interfaz.
    Claves `<empresa>/<archivo>/<variante>.webp`, generadas por la API.
  - Subida (`modules/files/images.ts`): cuerpo crudo hasta `UPLOAD_MAX_MB` (5); solo PNG/JPG/WebP reconocidos
    por su firma de bytes (no por extensión ni Content-Type; SVG no). sharp decodifica con límite de píxeles y
    re-codifica a WebP sin metadatos: `orig` (≤ 1600 px), `400` y `96` (cuadradas, fondo transparente).
  - Entrega: `GET /api/v1/files/<empresa>/<archivo>/<variante>.webp?exp&sig` sin sesión (un `<img>` no envía el token).
    La API firma la URL (HMAC) al devolver el registro dueño, que ya pasó autenticación, permiso y RLS. La firma vence
    en 6 a 12 h y es estable en esa ventana (caché privada del navegador). Un enlace filtrado sirve hasta que vence.
  - La imagen es un subrecurso del dueño y hereda su permiso: `PUT/DELETE /inventory/products/:id/image`
    (INV_PRODUCTS edit). Reemplazar o borrar elimina el archivo anterior tras el commit; borrar el producto también.
  - `products.barcode`: único por empresa; el listado y `/lookups/products` buscan también por código de barras
    (coincidencia exacta). El buscador de productos y el listado muestran la miniatura.
  - Respaldo: el servicio `backup-files` empaqueta el volumen `uploads` a diario en `./backups/uploads` (14 días).
  - `scripts/smoke/files.mjs` cubre validación, firmas, reemplazo, borrado y aislamiento por empresa.
- Fase 12 (migración `20261031_1201_company_branding`):
  - `companies.logo_file_id`, `icon_file_id` y `brand_color` (#rrggbb). La FK compuesta `(id, logo_file_id) → files (company_id, id)`
    obliga a que el archivo sea de la propia empresa. Se editan en Parámetros → Empresa (SET_COMPANY edit):
    `PUT/DELETE /settings/company/logo|icon`; el color va con el formulario (`null` lo quita, ausente lo conserva).
  - `modules/files/images.ts` tiene perfiles de variantes: producto (`orig/400/96.webp`), logo (`orig.webp`, `h96.webp` para la
    cabecera, `doc.png` para Excel/PDF/correo, que no admiten WebP) e ícono (`orig.webp`, `192.png`, `32.png` favicon).
  - `companyBranding(companyId)` (`modules/settings/branding.ts`) reúne razón social, RIF, contacto, color y el logo PNG.
  - Sitio: la sesión trae `company.logo/icon/brandColor` (URLs firmadas, se renuevan con cada refresh). El logo reemplaza al de
    FabriHub en la cabecera, el color marca su borde y el ícono es el favicon. El login sigue con la marca FabriHub.
  - Excel: logo, «razón social · RIF», nombre del reporte y fecha de emisión; el encabezado de columnas usa el color de la empresa.
  - PDF (`lib/pdf.ts`, pdfkit con fuentes estándar): orden de venta, nota de entrega y orden de compra
    (`GET …/:id/pdf`, con las mismas reglas de visibilidad que su pantalla). Sello «BORRADOR»/«ANULADA», tabla que repite
    encabezado, IVA por alícuota, retenciones, firmas y paginación. La fase 13 lo reutilizará para el ticket.
  - Correos (OTP, contraseña temporal, alertas): logo incrustado por CID (sin enlaces externos), nombre en el asunto y color.
    El OTP usa la empresa por defecto del usuario; la contraseña temporal, la empresa donde se dio el acceso.
  - No se implementó el logo para modo oscuro: la app no tiene modo oscuro (`files.purpose` ya admite `company_logo_dark`).
  - `scripts/smoke/branding.mjs` cubre subida, sesión, color, Excel, PDF, correo, aislamiento por empresa y retiro.
- Fase 13 (migración `20261101_1301_pos`):
  - Módulo raíz `POS` con tres hojas: `POS_TERMINALS` (cajas), `POS_SESSIONS` (turnos: add_new abre, close cierra) y
    `POS_SALES` (add_new vende; view/view_all comprobantes; **approve = supervisor**). Rutas en `/api/v1/pos`.
  - `pos_terminals`: almacén, lista de precios de venta, cliente por defecto y correlativo propio (`ticket_prefix` único
    por empresa + `next_ticket`). Con turnos no se elimina (se desactiva); tras emitir comprobantes su prefijo no cambia.
  - `pos_sessions` (correlativo `TUR`): un turno abierto por caja y por cajero (índices únicos parciales). Fondo de apertura
    en efectivo por moneda. `pos_sessions_counts`: esperado = fondo + cobrado − vuelto, por medio y moneda (ventas no anuladas).
    Al cerrar, el efectivo debe contarse; lo electrónico no declarado se da por conciliado. Si la diferencia en moneda base
    supera `POS.max_cash_difference`, el cierre exige observación.
  - Venta (`POST /pos/sales`, una transacción): `buildOrder` (motor de las órdenes de venta, ahora con `opts.priceListId` de la
    caja y sin retenciones) recalcula precio e IVA; salida `VENTA_POS` por FEFO sobre lo libre (no reservado) de lotes aprobados
    y vigentes del almacén de la caja, con costo por línea; pagos `cash/card/mobile/transfer` con su moneda, la tasa del día y
    su equivalente en moneda base. Solo el efectivo da vuelto (en la moneda que se indique); punto, pago móvil y transferencia
    exigen referencia. `POST /pos/sales/quote` cotiza sin guardar (totales, IVA por alícuota, IGTF, pendiente, vuelto).
  - IGTF (`POS.igtf_enabled`, `igtf_rate` 3 %): sobre la parte del total pagada en divisas (`min(pagado en divisas, total)`).
    Es una aproximación operativa: **debe confirmarla un contador**.
  - Supervisor: usuario con `approve` en POS_SALES. Si el cajero no lo es, un descuento (línea combinado con el global) mayor a
    `POS.max_discount_pct` (5 %) y toda anulación piden `supervisor: { userId, pin }`. La clave (4–8 dígitos, bcrypt en
    `users.pos_pin_hash`) la fija el propio supervisor con su contraseña (`PUT /pos/supervisor-pin`); 5 fallos la bloquean
    15 min (423). Se verifica fuera de la transacción para que el conteo de fallos persista. La auditoría no registra la clave.
  - Anular (`POST /pos/sales/:id/void`) solo mientras el turno sigue abierto: reversa el movimiento de inventario. Con el turno
    cerrado corresponde una devolución (nota de crédito, fase posterior). Las ventas no se borran (`REVOKE DELETE`).
  - Clientes: búsqueda por RIF/cédula/nombre y alta rápida (`POST /pos/customers`); `customers.rif` admite ahora cédula sin
    dígito verificador (`V-12345678`). Sin cliente: el de la caja o «Consumidor final» (`CONSUMIDOR_FINAL`, se crea al primer uso).
  - Catálogo (`GET /pos/catalog?terminalId&search`): vendibles con imagen, precio (lista de la caja o referencia), IVA, disponible
    y código de barras; código de barras exacto primero, luego parecido del nombre (índices `pg_trgm` en nombre y código).
  - Comprobante PDF (`GET /pos/sales/:id/pdf`, `renderPdf`): pagos, vuelto, IGTF, sello «ANULADA» y la leyenda
    «Este comprobante no es una factura fiscal». La homologación SENIAT (máquina/imprenta fiscal) queda para la fase 15.
  - Front: Punto de venta → Cajas (`/pos/terminals`) y «Mi clave de supervisor».
  - `scripts/smoke/pos.mjs` cubre cajas, turnos, catálogo, clientes, cotización, pagos combinados, IGTF, supervisor, anulación,
    arqueo, bloqueo de la clave y aislamiento por empresa.
- **Fase 14 (pantalla del punto de venta), notas:**
  - Caja (`/pos/sales`, POS_SALES add_new): sin turno muestra «Abrir turno» (caja libre + fondo por moneda). Con turno: catálogo
    con fotos y buscador (Enter agrega por código de barras/código exacto o resultado único; «3*código» agrega 3) y ticket en vivo
    a la derecha. Cada cambio se cotiza en el servidor (`/pos/sales/quote`, 200 ms de espera). Atajos: F2 buscar, F9 cobrar.
  - La cuenta en curso se guarda en el navegador (zustand persist `fabrihub-pos-cart`) y se descarta si cambia el turno.
  - Cobro: efectivo / punto de venta / pago móvil / transferencia en cualquier moneda con tasa del día, botón «Exacto» (considera
    el IGTF), vuelto en la moneda elegida y clave de supervisor cuando el descuento supera el máximo. Al confirmar: número de
    comprobante, vuelto a entregar y PDF.
  - `GET /pos/me` devuelve además las monedas con tasa de hoy y los parámetros (`maxDiscountPct`, `igtfEnabled`, `igtfRate`).
  - Comprobantes (`/pos/sales/tickets`, filtro `?session=`): detalle, PDF y anulación con supervisor. Turnos (`/pos/sessions`):
    arqueo por medio y moneda, «Ver sus ventas» y cierre (efectivo a contar; medios electrónicos precargados con lo esperado).
  - `ModuleHeader` resalta la acción más específica que coincide con la ruta.

### 10.2 Ampliación: Costa Rica, tipos de cambio automáticos y documento fiscal del POS

Objetivo: que una empresa pueda operar en **Venezuela o Costa Rica**, con su moneda, impuestos,
identificación fiscal y tipo de cambio oficial, y que el punto de venta emita el documento que exige
cada país. Plan acordado por etapas; cada etapa se entrega probada (smoke + navegador) antes de la siguiente.

| Fase | Contenido | Estado |
|---|---|---|
| **15. País de la empresa** | Catálogo de países con su configuración fiscal; colón (CRC); impuestos, tratamientos y retenciones por país; identificación fiscal por país; zona horaria por empresa | Terminada |
| **16. Tipos de cambio automáticos** | Proveedores de tasa (BCCR y BCV) detrás de una interfaz común, tarea diaria por empresa, historial con fuente, carga manual de respaldo | Terminada |
| **17. Ticket imprimible del POS** | Ticket térmico de 58/80 mm desde la caja (impresión del navegador), plantilla por país, reimpresión marcada «COPIA» | Terminada |
| **18. Costa Rica: comprobantes electrónicos 4.4** | Tiquete y factura electrónica: CABYS, clave y consecutivo, XML 4.4 firmado, envío y consulta a Hacienda, nota de crédito para anular | Terminada (sandbox simulado; falta probar con credenciales reales) |
| **19. Venezuela: documento fiscal** | Emisor fiscal intercambiable: impresora fiscal homologada (agente local) o imprenta digital (API), con contingencia; nota de crédito para anular | En curso (API, migración y simuladores listos; faltan pantallas y prueba de humo) |

- **Fase 15 (país):**
  - `catalogs_countries` (global): `VE`, `CR` con moneda por defecto, zona horaria (`America/Caracas`,
    `America/Costa_Rica`), tipos de identificación y banderas de lo que aplica en cada país
    (IGTF, retenciones de IVA/ISLR, comprobante electrónico).
  - `companies.country_code` reemplaza el texto libre `country`; clientes y proveedores también.
  - Hoy son globales y venezolanos: impuestos (`taxes`, `taxes_rates`), retenciones (`withholdings*`) y
    tratamientos fiscales. Llevan `country_code`; cada empresa solo ve los de su país.
  - Costa Rica: IVA general 13 % y tarifas reducidas 4 %, 2 %, 1 % y 0 %, más exento. No hay IGTF ni
    retenciones de IVA al estilo venezolano: el POS y las compras las activan según el país.
  - Identificación: hoy un `CHECK` de RIF (`^[VEJPG]-…`) en empresas, clientes y proveedores. Pasa a
    `id_type` + `id_number` validados por país (VE: RIF y cédula; CR: física 9 dígitos, jurídica 10,
    DIMEX 11–12, NITE 10, extranjero). Etiquetas «RIF» / «Cédula» en pantallas, PDF y Excel.
  - Moneda **CRC** (colón, ₡, 2 decimales). La moneda base de una empresa de CR es CRC.
  - **Zona horaria por empresa:** hoy «hoy» se calcula con `CURRENT_DATE` en la zona de la BD (Caracas).
    Costa Rica va 2 horas atrás; sin esto, una venta a las 11 p. m. en CR caería en el día siguiente.
  - Empresa demo de Costa Rica para las pruebas (smoke de aislamiento por país).
  - **Hecho (2026-11-03, migración `20261103_1501_countries`):** `catalogs_countries` con tipos de
    identificación (patrón, ejemplo, `explicitOnly` para el extranjero de CR, que no se deduce del formato)
    y banderas (`igtf`, `withholdings`, `specialTaxpayer`, `eInvoice`). Se conservó la columna `rif` como
    número de identificación genérico (VARCHAR 20) con `id_type`; el trigger `fn_check_tax_id` valida contra
    el país. Impuestos, retenciones y tratamientos con `country_code` + política RLS `p_country`; triggers
    impiden usar tratamientos de otro país. `db.ts` fija `TimeZone` por empresa en cada consulta y
    transacción. IGTF condicionado por `fn_country_has('igtf')`. Front: `TaxIdInput` (tipo + número,
    detecta el tipo y normaliza), país elegido al crear la empresa (fijo después), etiquetas por país.
    Smoke `countries.mjs` (26 verificaciones); batería completa 529/529. Falta desplegar en producción
    (respaldo previo de la BD).
- **Fase 16 (tipos de cambio):**
  - Interfaz `RateProvider` (`fetch(fecha) → [{moneda, tasa, fuente}]`) y una tarea diaria por empresa
    (`runInCompany`) según su país. Botón «Actualizar ahora» y alerta si la consulta falla.
  - **BCCR:** API REST SDDE, `https://apim.bccr.fi.cr/SDDE/api/Bccr.GE.SDDE.Publico.Indicadores.API`,
    `GET /indicadoresEconomicos/{codigo}/series?fechaInicio=yyyy/mm/dd&fechaFin=…&idioma=ES` con
    `Authorization: Bearer <token>`. El token se genera registrándose en el sitio de Indicadores
    Económicos (Mi Perfil → Generar token); se guarda cifrado por empresa. Indicadores 317 (compra) y
    318 (venta) colón/dólar, a confirmar en el catálogo oficial. El servicio SOAP anterior
    (`wsindicadoreseconomicos.asmx`) fue sustituido por el SDDE.
  - **BCV:** no publica una API oficial. Opciones: leer la tasa de la página oficial `bcv.org.ve`
    (frágil si cambian el HTML) o un servicio de terceros. Se implementa la lectura de la página oficial
    con validaciones (rango razonable, fecha valor) y la carga manual queda como respaldo.
  - `currencies_rates.source` registra la fuente (`BCCR`, `BCV`, `MANUAL`) y la fecha valor.
  - **Hecho (2026-11-03, migración `20261104_1601_exchange_rates`):** `catalogs_countries.rate_provider`
    (VE → BCV, CR → BCCR); `currencies_rates.is_automatic` + `value_date` (una tasa manual nunca se pisa;
    corregir a mano una automática la vuelve manual); bitácora `exchange_rate_runs`; `company_secrets` con el
    token del BCCR cifrado AES-256-GCM (`SECRETS_KEY`, o derivada de `JWT_ACCESS_SECRET`). Parámetros SETTINGS:
    `rates_auto_enabled` (apagado de fábrica), `rates_interval_hours` (4) y `rates_bccr_side` (venta 318 /
    compra 317; solo se lista en CR gracias a `rules.countries`). La tarea revisa cada 10 min y reintenta a la
    hora tras un error; alerta `RATES_FAILED`. Las cotizaciones se convierten a la moneda base de la empresa.
    El BCV envía su certificado sin el intermedio: `lib/httpFetch.ts` lo descarga desde la extensión AIA y valida
    contra las raíces del sistema (sin desactivar la verificación). Probado en vivo contra bcv.org.ve; el BCCR,
    con un servidor simulado (falta el token real). Front: panel «Tasas automáticas» en Monedas. Smoke
    `rates.mjs` (29 verificaciones); batería 557/557. El cliente de humo reintenta tras el límite general
    (600/min).
- **Fase 17 (ticket imprimible):**
  - Vista de ticket de 58/80 mm con CSS de impresión (`@page`), sin depender de controladores: imprime
    en cualquier impresora térmica instalada. Configuración por caja (ancho, copias, impresión automática).
  - Plantilla por país: datos fiscales del emisor y del cliente, desglose de impuestos, pagos, vuelto,
    y las leyendas que exija cada régimen (en VE, «no es factura fiscal» mientras no haya emisor fiscal).
  - **Hecho (2026-11-03, migración `20261105_1701_pos_ticket_print`):** por caja, `ticket_width_mm` (58/80),
    `ticket_copies` (1–3), `auto_print` y `ticket_footer`; bitácora `pos_sales_prints` (la 1.ª impresión es el
    original, las siguientes salen «COPIA»; sin UPDATE/DELETE para la app). API `GET /pos/sales/:id/ticket`
    (vista previa) y `POST /pos/sales/:id/print` (registra y devuelve el ticket), en `api/src/modules/pos/ticket.ts`,
    con leyendas por país (VE: «no es factura fiscal»; CR: «documento provisional», no sustituye al comprobante
    de Hacienda) y marcas de alícuota (VE: G/R/A/E; CR: 13%/E). Front: plantilla HTML con `@page` en
    `app/pos/components/ticket/ticketHtml.ts`, impresa por un iframe oculto; botones Imprimir/Ver en «Venta
    registrada» y en Comprobantes; impresión automática si la caja lo pide (sin diálogo: Chrome con
    `--kiosk-printing`). El PDF del comprobante también usa la leyenda del país. Smoke `ticket.mjs`
    (24 verificaciones, incluida una venta en Costa Rica); batería 581/581. Vista previa revisada en el navegador.
- **Fase 18 (Costa Rica, comprobantes electrónicos):**
  - Versión **4.4** obligatoria desde el 1 de septiembre de 2025 (Resolución MH-DGT-RES-0027-2024).
    En CR no se usan impresoras fiscales: el POS emite un **tiquete electrónico** (consumidor final) o una
    **factura electrónica** (cliente identificado) y el papel es solo su representación impresa.
  - Datos nuevos: código **CABYS** por producto, actividad económica de la empresa, sucursal y terminal
    por caja, condición de venta, medio de pago con los códigos de Hacienda.
  - Clave numérica de 50 dígitos y consecutivo de 20 (sucursal + terminal + tipo + número).
  - XML 4.4 firmado (XAdES-EPES) con la llave criptográfica (.p12) de la empresa; token OAuth del
    IdP de Hacienda; envío a la API de recepción y consulta del estado (aceptado / rechazado).
    Primero en el ambiente de pruebas (sandbox).
  - Cola de envío con reintentos y modo contingencia; una venta no se anula: se emite **nota de crédito**.
  - El código QR en la representación impresa está suspendido; se imprime la clave y el consecutivo.
  - **Hecho (2026-11-03, migración `20261106_1801_cr_einvoice`):** `products.cabys_code`, `catalogs_units.hacienda_code`,
    sucursal/terminal por caja (`einv_branch`, `einv_terminal`), `einvoice_settings` (actividad, ubicación, ambiente,
    contingencia), `einvoice_sequences` y `einvoice_documents` (cola: pending → sent → accepted/rejected; cancelled).
    Módulo `api/src/modules/einvoice/`: `xml.ts` escribe el XML 4.4 ya canónico (C14N); `signer.ts` firma XAdES-EPES
    (RSA-SHA256, 3 referencias SHA-256, política del Anexo 2 v4.4 con su SHA-256 verificado contra el PDF oficial) leyendo
    el .p12 con node-forge 1.4.0; `hacienda.ts` (token del IdP `rut-stag`/`rut`, recepción `recepcion-sandbox/v1` y
    `recepcion/v1`); `service.ts` reserva clave y consecutivo en la transacción de la venta, nota de crédito (código 01)
    al anular, cola con reintentos crecientes cada minuto, contingencia (situación 3). Credenciales del ATV y llave .p12
    + PIN cifradas en `company_secrets`. Alerta `EINV_FAILED`. Ticket: tipo, consecutivo, clave y estado. Front:
    Configuración → Comprobantes (solo países con `eInvoice`), CABYS en el producto, sucursal/terminal en la caja.
    Validación: XML de TE/FE/NC validan contra los XSD oficiales (xmllint) y la firma verifica con xmlsec1. Smoke
    `einvoice.mjs` (51 verificaciones con Hacienda simulado y llave de prueba autofirmada); batería 632/632.
    Corregido de paso: el PATCH parcial de productos pisaba campos no enviados con los valores por defecto.
- **Fase 19 (Venezuela, documento fiscal):**
  - Marco cambiante: la Providencia **SNAT/2026/00093** (G. O. 43.484, 21/10/2026) hace **opcional** la
    máquina fiscal y admite medios digitales (portal/app del SENIAT, imprentas digitales, proveedores
    autorizados); rige a los 180 días (≈ abril 2027). La SNAT/2026/00084 derogó la homologación de
    sistemas de facturación (SNAT/2024/000121). Hasta entonces sigue el régimen de máquinas fiscales.
  - Diseño: interfaz `FiscalIssuer` por caja con implementaciones
    1. **Sin emisor** (comprobante no fiscal, como hoy);
    2. **Impresora fiscal homologada**: el navegador no habla con el puerto serie; se necesita un
       **agente local** en la PC de la caja que traduzca la venta al protocolo del fabricante y devuelva
       el número fiscal (factura y reporte Z);
    3. **Imprenta digital**: la API del proveedor autorizado asigna el número de control y devuelve el PDF.
  - Contingencia: formato físico y registro posterior, como prevé la providencia.
  - Anulación con **nota de crédito** fiscal; el IGTF se mantiene en el documento.

**Decisiones pendientes del usuario (antes de la fase indicada):**
- Fase 16: registrarse en el sitio de Indicadores Económicos del BCCR, generar el token y cargarlo en Catálogos comerciales → Monedas (lo hace el titular; sin él, Costa Rica queda con carga manual).
- Fase 18: credenciales del ambiente de pruebas de Hacienda (usuario ATV de pruebas y llave .p12 con su PIN), la actividad económica inscrita y la ubicación (provincia/cantón/distrito) para probar contra el sandbox real; luego pasar a producción.
- Fase 19: ¿impresora fiscal (marca y modelo disponibles) o imprenta digital (qué proveedor)?

Existe un borrador anterior en `C:\Workspace\Proyecto\fabrihub`. Su lógica SQL de dominio
(explosión, MRP y trigger de movimientos, en esquemas en español) **se reutiliza al portarla** a las
convenciones de este plan. Su seguridad (`rol_permiso`) y su front (HTML estático) **se reemplazan**
por el modelo DaviHub descrito aquí.
