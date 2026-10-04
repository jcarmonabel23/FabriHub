# FabriHub

Planificación y Control de la Producción e Inventarios para PYMEs manufactureras. Es la implementación
de la tesis UCAB (Palma, G.; caso Laboratorios COFASA) con la arquitectura, la seguridad y el estilo de
DaviHub. El plan completo está en [PLAN.md](PLAN.md).

## Arranque

```bash
cp .env.example .env              # cambie TODOS los secretos
openssl rand -hex 32              # → JWT_ACCESS_SECRET
docker compose up -d --build
```

| Servicio | URL | Nota |
|---|---|---|
| FabriHub | http://localhost:8080 | front + proxy `/api` (la API y la BD no se publican) |
| Mailpit | http://127.0.0.1:8025 | bandeja donde llegan los OTP y las contraseñas temporales |
| pgAdmin | http://127.0.0.1:5050 | `docker compose --profile tools up -d` |

Primer ingreso: `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD` del `.env`, luego el código OTP que llega a Mailpit.
Por último, el cambio obligatorio de contraseña.

Para reiniciar la BD desde cero (vuelve a ejecutar `db/init`): `docker compose down -v`.

## Desarrollo

```bash
cd front && npm install && npm run dev     # http://localhost:5173, usa la API del contenedor vía :8080
cd api   && npm install && npm run typecheck && npm test   # motor fiscal
cd front && npm test                       # reglas de acceso y política de contraseñas
docker compose down -v && docker compose up -d && sh scripts/smoke.sh   # 253 pruebas end-to-end
```

`scripts/smoke.sh` necesita la BD recién creada (usa la contraseña inicial del admin) y termina con la
prueba de límite por IP, que deja esa IP bloqueada 15 minutos.

## Base de datos: línea base + migraciones

- `db/init/`: línea base (fases 0 a 2). Solo corre con el volumen vacío.
- `db/migrations/`: fase 3 en adelante. El servicio `migrate` las aplica en cada `docker compose up`, una
  vez cada una y en su propia transacción, **sin borrar datos**. La API no arranca si una migración falla.
- Para cambiar el esquema se crea un archivo nuevo `AAAAMMDD_NNNN_descripcion.sql`. Nunca se edita una
  migración ya aplicada: el checksum lo detecta y detiene el arranque. En el SQL, `:"app_user"` es el rol de la app.

## Estructura

```
db/init/        SQL numerado (convención davihub-core-db)
                000xx catálogos de seguridad · 001xx seguridad · 002xx parámetros · 003xx impuestos
db/migrations/  fase 3 en adelante (servicio migrate)
api/            Node 22 + TS + Express: un handler por acción (como las lambdas de DaviHub)
  src/security/   authenticate · requirePermission · tokens · trace · rate limits
  src/modules/    auth · admin · settings (motor genérico de catálogos) · taxes (motor fiscal) · inventory · lookups · metrics
front/          React 19 + Vite + Mantine 8 + Tailwind 4 + Zustand (estructura davihub-front)
  server.ts       Express: estáticos + proxy /api + CSP
scripts/smoke/  suites end-to-end por fase (security, settings-taxes, inventory, purchases, production, sales, ratelimit)
```

## Estado

- **Fase 0 (base):** lista. `docker compose up` levanta db, api, front, mailpit y backup con health checks.
- **Fase 1 (seguridad):** lista. Incluye:
  - Login con OTP por correo y cambio obligatorio de contraseña.
  - Política de contraseñas con historial de 5.
  - Bloqueo de la cuenta tras 5 intentos y límite de intentos por IP.
  - Refresh rotativo con detección de robo y revocación inmediata.
  - Cierre por inactividad.
  - RBAC por módulo (roles + extras) aplicado en la API y en el front, con protecciones anti-bloqueo.
  - Auditoría de datos y de accesos, inmutable para la app.
  - Administración de usuarios, roles, módulos y auditoría.
- **Fase 2 (Parámetros e Impuestos):** lista. Incluye:
  - **Empresa:** datos fiscales (RIF validado), moneda base, contribuyente especial, agente de retención.
  - **Parámetros por módulo:** valores tipados y validados, con restauración al valor de fábrica.
  - **Correlativos:** numeración de documentos atómica que no retrocede.
  - **Catálogos comerciales** con motor genérico: condiciones de pago y de entrega, métodos de entrega,
    tipos de negocio, zonas y monedas, más las tasas de cambio diarias.
  - **Impuestos y tarifas;** retenciones con tramos ilimitados (la "Tarifa 1 al 4" de la tesis normalizada).
  - **Tratamientos fiscales** con vigencia y un simulador que usa el mismo motor fiscal que usarán
    las órdenes de compra y venta.
- **Fase 3 (Inventario):** lista. Incluye:
  - **Productos:** unidades de compra, venta y producción con su factor; manejo por lote, vida útil, retenido;
    relaciones sustituto, complementario y equivalente.
  - **Almacenes:** con stock mínimo y máximo, y **alcance por almacén** por usuario.
  - **Lotes:** vencimiento, estado de calidad, retener o liberar la retención, y trazabilidad.
  - **Movimientos:** entradas, salidas y traslados que se contabilizan en la BD a **costo promedio ponderado**.
    Son inmutables: se corrigen con un reverso al costo original.
  - **Existencias:** saldos valorados, **kárdex** y **alertas** (bajo el mínimo y lotes por vencer).
  - Datos de demostración del caso farmacéutico.
- **Fase 4 (Compras y Calidad):** lista. Incluye:
  - **Proveedores** con contactos, moneda, condiciones y tratamiento fiscal; **compradores**.
  - **Listas de precios de compra** con vigencia y promociones; precio sugerido con conversión de moneda.
  - **Órdenes de compra:** totales en vivo con el motor fiscal (descuentos, IVA y retenciones), flujo
    borrador → por aprobar → aprobada → recibida/cerrada, y **segregación de funciones** (quien la crea no la aprueba).
  - **Recepciones** parciales con tolerancia, factor de unidad y costo en moneda base; anulación por reverso
    y **devolución al proveedor**.
  - **Calidad:** todo lote recibido entra en **cuarentena**; la liberación o el rechazo queda registrado de
    forma inmutable y no lo puede decidir quien recibió o fabricó el lote.
- **Fase 5 (Producción):** lista. Incluye:
  - **Etapas, centros de producción y centros de trabajo** (capacidad, eficiencia y tarifas por hora de
    mano de obra y costo fabril).
  - **Rutas** con tiempos teóricos: preparación fija + ejecución por cantidad base.
  - **Fórmulas** versionadas con merma y componentes críticos. **Explosión** e **implosión** multinivel
    en la BD, con detección de ciclos y verificación de existencia.
  - **Órdenes de producción** con el ciclo de la tesis: creada → liberada (reserva FEFO de lotes
    aprobados) → en proceso (consumo CONS_PROD) → confirmada (lote nuevo en cuarentena, ENT_PROD al
    costo real) → cerrada (variación real vs. estándar). Un faltante crítico impide liberar.
  - **Seguimiento** por etapa, en orden, con horas reales, cantidad buena y merma.
  - Reservas genéricas (`stock_reservations`) que mantienen `stock_balances.reserved` por trigger:
    lo reservado no lo puede sacar ningún otro movimiento.
- **Fase 6 (Ventas):** lista. Incluye:
  - **Clientes** con contactos, vendedor, lista de precios, límite de crédito y marca de contribuyente
    especial; **vendedores** con comisión.
  - **Listas de precios de venta** con el mismo motor y la misma pantalla que Compras.
  - **Órdenes de venta** con el motor fiscal: los medicamentos exentos y la vitamina gravada; si el cliente
    es contribuyente especial se calcula lo que retendrá y el neto a cobrar.
  - **Control de crédito:** si las órdenes abiertas superan el límite, la orden queda retenida y la aprueba
    otra persona (segregación de funciones). Sin `view_all`, cada vendedor ve solo sus órdenes.
  - **Reserva FEFO** al confirmar; lo que falta queda como pedido pendiente (o se rechaza si
    `allow_backorder` está apagado) y se puede volver a reservar cuando entra existencia.
  - **Notas de entrega:** FEFO automático o lotes elegidos a mano (validados con `enforce_fefo`), salida
    DESP_VENTA al costo promedio, margen bruto por nota, anulación por reverso.
  - **Trazabilidad lote → cliente** para retiros del mercado.
- **Siguiente:** fase 7, Planificación (plan de ventas → MPS → MRP).
