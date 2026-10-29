/**
 * @project FabriHub - API
 * @file src/bootstrap.ts
 * @description Arranque: espera la BD y garantiza el usuario administrador inicial
 *
 * @overview
 * Si no existe el usuario ADMIN_EMAIL, lo crea con ADMIN_INITIAL_PASSWORD y la marca de
 * cambio obligatorio. En cada arranque se asegura que pertenezca a TODAS las empresas y
 * tenga el rol `admin` en TODOS sus módulos (incluidos los que se agreguen en fases nuevas),
 * para que nunca quede el sistema sin quien lo administre. Es la cuenta maestra y el
 * administrador de plataforma: para el día a día conviene crear otros administradores con
 * módulos acotados.
 */

import { config } from "./config.js";
import { one, pool, query, withTx } from "./db.js";
import { logger } from "./lib/logger.js";
import { hashPassword } from "./lib/passwords.js";

async function waitForDb(retries = 30): Promise<void> {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (i === retries) throw err;
      logger.warn({ attempt: i }, "[bootstrap] esperando a la base de datos…");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function bootstrap(): Promise<void> {
  await waitForDb();

  const adminId = await withTx({ traceId: null, userId: null }, async (client) => {
    let admin = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [config.ADMIN_EMAIL], client);
    if (!admin) {
      const hash = await hashPassword(config.ADMIN_INITIAL_PASSWORD);
      admin = await one<{ id: string }>(
        `INSERT INTO users (email, names, password_hash, must_change_password, is_platform_admin)
         VALUES ($1, 'Administrador', $2, TRUE, TRUE) RETURNING id`,
        [config.ADMIN_EMAIL, hash],
        client
      );
      logger.info({ email: config.ADMIN_EMAIL }, "[bootstrap] usuario administrador creado (debe cambiar la contraseña)");
    }
    await client.query(`UPDATE users SET is_platform_admin = TRUE WHERE id = $1 AND NOT is_platform_admin`, [admin!.id]);

    // Miembro de todas las empresas; la por defecto, la más antigua (si aún no tiene una)
    await client.query(
      `INSERT INTO users_companies (user_id, company_id, is_default)
       SELECT $1, c.id, NOT EXISTS (SELECT 1 FROM users_companies d WHERE d.user_id = $1 AND d.is_default)
              AND c.id = (SELECT id FROM companies ORDER BY created_at, code LIMIT 1)
         FROM companies c
       ON CONFLICT (user_id, company_id) DO NOTHING`,
      [admin!.id]
    );
    return admin!.id;
  });

  // Los permisos son por empresa (RLS): se asignan dentro de cada una
  const companies = await query<{ id: string }>(`SELECT id FROM companies`);
  for (const company of companies) {
    await withTx({ traceId: null, userId: null, companyId: company.id }, (client) =>
      client.query(
        `INSERT INTO users_modules (user_id, module_id, role_ids)
         SELECT $1, m.id, jsonb_build_array((SELECT id::text FROM catalogs_roles WHERE slug = 'admin'))
           FROM catalogs_modules m
          WHERE m.module_parent_id IS NOT NULL
         ON CONFLICT (company_id, user_id, module_id) DO NOTHING`,
        [adminId]
      )
    );
  }
}
