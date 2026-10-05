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
- Todas las fases del plan están completas.

Existe un borrador anterior en `C:\Workspace\Proyecto\fabrihub`. Su lógica SQL de dominio
(explosión, MRP y trigger de movimientos, en esquemas en español) **se reutiliza al portarla** a las
convenciones de este plan. Su seguridad (`rol_permiso`) y su front (HTML estático) **se reemplazan**
por el modelo DaviHub descrito aquí.
