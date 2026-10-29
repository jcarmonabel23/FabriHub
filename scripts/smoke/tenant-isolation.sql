-- =====================================================================
--  FabriHub · scripts/smoke/tenant-isolation.sql   (fase 9: multiempresa)
--  Aislamiento entre empresas a nivel de BD, con el rol de la aplicación.
--
--  Crea una segunda empresa (B) con datos mínimos y verifica que, con la empresa
--  PRINCIPAL (A) activa, la app no ve, no modifica ni referencia nada de B.
--  Todo corre en una transacción que se deshace al final: no deja rastro.
--
--  psql -v ON_ERROR_STOP=1 -v app_user=fabrihub_app -U <dueño> -d fabrihub -f tenant-isolation.sql
--  Un fallo aborta con "ASSERT ... FALLÓ: <qué>".
-- =====================================================================

\set QUIET on
BEGIN;

-- --------------------------------------------------------------- Datos de la empresa B (como dueño)
SELECT id AS company_a FROM companies WHERE code = 'PRINCIPAL' \gset

INSERT INTO companies (code, legal_name, rif, base_currency_id)
SELECT 'PRUEBA_B', 'Empresa de prueba B', 'J-99999999-9', base_currency_id FROM companies WHERE code = 'PRINCIPAL'
RETURNING id AS company_b \gset

-- Mismos códigos que en A: los únicos son por empresa
INSERT INTO warehouses (company_id, code, name) VALUES (:'company_b', 'MP', 'Materia prima B')
RETURNING id AS warehouse_b \gset
INSERT INTO products (company_id, code, name, product_type_id, stock_unit_id)
SELECT :'company_b', 'SOLO-B', 'Producto exclusivo de B', t.id, u.id
  FROM catalogs_product_types t, catalogs_units u WHERE t.code = 'MP' AND u.code = 'KG'
RETURNING id AS product_b \gset

INSERT INTO parameters (company_id, module_code, order_list, key, name, description, data_type, value, default_value, rules)
SELECT :'company_b', module_code, order_list, key, name, description, data_type,
       CASE WHEN key = 'allow_negative_stock' THEN 'true'::jsonb ELSE value END, default_value, rules
  FROM parameters WHERE company_id = :'company_a';
INSERT INTO document_sequences (company_id, doc_type, name, module_code, prefix, padding, next_number)
SELECT :'company_b', doc_type, name, module_code, prefix, padding, 500 FROM document_sequences WHERE company_id = :'company_a';

INSERT INTO inventory_movements (company_id, number, concept_id, direction, warehouse_id, notes)
SELECT :'company_b', 'MI-B-000001', id, 'in', :'warehouse_b', 'Movimiento de B' FROM catalogs_movement_concepts WHERE code = 'INV_INI'
RETURNING id AS movement_b \gset
INSERT INTO inventory_movements_details (company_id, movement_id, line_no, product_id, quantity, unit_cost)
VALUES (:'company_b', :'movement_b', 1, :'product_b', 10, 1);

SELECT next_number AS seq_b_before FROM document_sequences WHERE company_id = :'company_b' AND doc_type = 'MOV' \gset

-- Los bloques DO no leen variables de psql: se pasan como ajustes de sesión
SELECT set_config('test.company_b', :'company_b', false), set_config('test.product_b', :'product_b', false),
       set_config('test.movement_b', :'movement_b', false), set_config('test.seq_b_before', :'seq_b_before', false) \gset

-- --------------------------------------------------------------- Como la aplicación, en la empresa A
SET ROLE :"app_user";
SELECT set_config('app.company_id', :'company_a', false) \gset

DO $$
BEGIN
    -- Lectura: nada de B es visible
    ASSERT (SELECT COUNT(*) FROM products WHERE code = 'SOLO-B') = 0, 'FALLÓ: A ve un producto de B';
    ASSERT (SELECT COUNT(*) FROM products WHERE company_id <> fn_current_company()) = 0, 'FALLÓ: A ve productos de otra empresa';
    ASSERT (SELECT COUNT(*) FROM warehouses WHERE code = 'MP') = 1, 'FALLÓ: A ve más de un almacén MP';
    ASSERT (SELECT COUNT(*) FROM inventory_movements WHERE number = 'MI-B-000001') = 0, 'FALLÓ: A ve movimientos de B';
    ASSERT (SELECT COUNT(*) FROM parameters WHERE company_id <> fn_current_company()) = 0, 'FALLÓ: A ve parámetros de B';
    ASSERT (SELECT COUNT(*) FROM v_stock_available) > 0, 'FALLÓ: A no ve su propio disponible';
    ASSERT (SELECT COUNT(*) FROM v_stock_available b JOIN warehouses w ON w.id = b.warehouse_id) = (SELECT COUNT(*) FROM v_stock_available),
        'FALLÓ: la vista expone saldos de almacenes ajenos';

    -- Parámetro de A (B lo tiene distinto)
    ASSERT fn_parameter('INVENTORY', 'allow_negative_stock') = 'false'::jsonb, 'FALLÓ: fn_parameter no leyó el valor de A';
END
$$;

-- Escritura sobre filas de B: no las alcanza (se verifica luego, desde B)
UPDATE products SET name = 'Hackeado' WHERE id = :'product_b';
DELETE FROM warehouses WHERE id = :'warehouse_b';

-- Intentos que deben fallar, cada uno en su propio savepoint
DO $$
DECLARE
    v_wh UUID := (SELECT id FROM warehouses WHERE code = 'MP');
    v_type UUID := (SELECT id FROM catalogs_product_types WHERE code = 'MP');
    v_unit UUID := (SELECT id FROM catalogs_units WHERE code = 'KG');
    v_ok BOOLEAN;
BEGIN
    -- 1) Insertar una fila marcada con otra empresa → RLS (WITH CHECK)
    v_ok := FALSE;
    BEGIN
        INSERT INTO products (company_id, code, name, product_type_id, stock_unit_id)
        VALUES (current_setting('test.company_b')::uuid, 'INTRUSO', 'Intruso', v_type, v_unit);
    EXCEPTION WHEN insufficient_privilege THEN v_ok := TRUE;
    END;
    ASSERT v_ok, 'FALLÓ: A insertó una fila con la empresa de B';

    -- 2) Referenciar un producto de B desde A → FK compuesta
    v_ok := FALSE;
    BEGIN
        INSERT INTO stock_policies (warehouse_id, product_id, min_qty) VALUES (v_wh, current_setting('test.product_b')::uuid, 1);
    EXCEPTION WHEN foreign_key_violation THEN v_ok := TRUE;
    END;
    ASSERT v_ok, 'FALLÓ: A referenció un producto de B';

    -- 3) Contabilizar un movimiento de B → no encontrado
    v_ok := FALSE;
    BEGIN
        PERFORM fn_post_inventory_movement(current_setting('test.movement_b')::uuid);
    EXCEPTION WHEN raise_exception THEN v_ok := SQLERRM = 'Movimiento no encontrado';
    END;
    ASSERT v_ok, 'FALLÓ: A contabilizó un movimiento de B';

    -- 4) Las funciones internas siguen vedadas a la app
    v_ok := FALSE;
    BEGIN
        PERFORM fn__post_inventory_movement(current_setting('test.movement_b')::uuid);
    EXCEPTION WHEN insufficient_privilege THEN v_ok := TRUE;
    END;
    ASSERT v_ok, 'FALLÓ: la app puede ejecutar el núcleo de contabilización';

    -- 5) Mismo código que en B, ahora en A → permitido (únicos por empresa)
    INSERT INTO products (code, name, product_type_id, stock_unit_id) VALUES ('SOLO-B', 'Ahora también en A', v_type, v_unit);
    ASSERT (SELECT company_id FROM products WHERE code = 'SOLO-B') = fn_current_company(), 'FALLÓ: company_id por defecto no es la empresa activa';

    -- 6) El correlativo avanza solo en A
    PERFORM fn_next_document_number('MOV');
END
$$;

-- Sin empresa activa: RLS no deja ver nada
SELECT set_config('app.company_id', '', false) \gset
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM products) = 0, 'FALLÓ: sin empresa activa se ven productos';
    ASSERT (SELECT COUNT(*) FROM v_stock_available) = 0, 'FALLÓ: sin empresa activa se ven saldos';
END
$$;

-- En la empresa B: ve lo suyo y nada de A
SELECT set_config('app.company_id', :'company_b', false) \gset
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM products) = 1, 'FALLÓ: B no ve exactamente su producto';
    ASSERT (SELECT name FROM products) = 'Producto exclusivo de B', 'FALLÓ: el producto de B fue alterado desde A';
    ASSERT (SELECT COUNT(*) FROM warehouses) = 1, 'FALLÓ: el almacén de B fue borrado desde A';
    ASSERT fn_parameter('INVENTORY', 'allow_negative_stock') = 'true'::jsonb, 'FALLÓ: fn_parameter no leyó el valor de B';
END
$$;

RESET ROLE;
DO $$
BEGIN
    ASSERT (SELECT next_number FROM document_sequences
             WHERE company_id = current_setting('test.company_b')::uuid AND doc_type = 'MOV') = current_setting('test.seq_b_before')::bigint,
        'FALLÓ: el correlativo de B avanzó por una operación de A';
END
$$;

\echo '  ✔ aislamiento entre empresas (RLS, FK compuestas, únicos por empresa, funciones de inventario)'
ROLLBACK;
