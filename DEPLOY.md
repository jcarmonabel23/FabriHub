# FabriHub · despliegue en Oracle Cloud

Servidor: `VM.Standard.A1.Flex` (ARM, 2 OCPU / 12 GB), Ubuntu 24.04, IP pública `217.71.200.20`.
Sin dominio propio se publica en **https://217-71-200-20.sslip.io**: `sslip.io` resuelve ese nombre a la IP
y Caddy obtiene un certificado real de Let's Encrypt. Para usar un dominio después, ver el último paso.

```
 Internet ──443──▶ caddy (HTTPS) ──▶ front (SPA + proxy /api) ──▶ api ──▶ db
                   único puerto publicado          red_app            red_datos (interna)
```

## 1. Consola de Oracle: abrir 80 y 443

*Networking → Virtual Cloud Networks → (su VCN) → Subnets → (subred pública) → Security Lists → Default
→ Add Ingress Rules*, dos reglas:

| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

El 22 (SSH) ya viene abierto. **No** abra 8080, 5432, 8025 ni 5050.

## 2. Correo SMTP

El login exige el código OTP por correo, así que sin SMTP nadie puede entrar. Dos opciones gratuitas:

| Proveedor | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` / `SMTP_PASSWORD` | Límite |
|---|---|---|---|---|
| **Gmail** (lo más rápido) | `smtp.gmail.com` | `587` | su Gmail / una **contraseña de aplicación** (exige verificación en 2 pasos: *Cuenta de Google → Seguridad → Contraseñas de aplicaciones*) | ~500/día |
| **Brevo** | `smtp-relay.brevo.com` | `587` | usuario y clave SMTP de *SMTP & API* (verificar el remitente) | 300/día |

Con Gmail, `SMTP_FROM` debe ser la misma cuenta: `FabriHub <sucorreo@gmail.com>`.

## 3. Preparar el servidor (una vez)

```bash
ssh -i <su-llave>.key ubuntu@217.71.200.20
curl -fsSL https://raw.githubusercontent.com/jcarmonabel23/FabriHub/JCA/initial_dev/scripts/deploy/setup-server.sh | sh
exit        # salir y volver a entrar para usar docker sin sudo
```

Instala Docker y git, abre 80/443 en el `iptables` de Ubuntu (las imágenes de Oracle lo traen cerrado)
y clona el repositorio en `~/FabriHub`.

## 4. Configurar y desplegar

```bash
ssh -i <su-llave>.key ubuntu@217.71.200.20
cd ~/FabriHub
cp .env.production.example .env.production
for i in 1 2 3 4 5; do openssl rand -hex 32; done     # secretos para los campos «CAMBIAR-openssl…»
nano .env.production                                   # reemplazar TODOS los «CAMBIAR»
sh scripts/deploy/deploy.sh
```

`deploy.sh` se niega a correr si queda algún `CAMBIAR`. Al terminar, abra **https://217-71-200-20.sslip.io**,
entre con `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD`, escriba el código que llega al correo y cambie la contraseña.

> Guarde `.env.production` fuera del servidor (gestor de contraseñas): sin `POSTGRES_PASSWORD` y
> `APP_DB_PASSWORD` no se pueden restaurar los respaldos. Nunca lo suba a GitHub (`.gitignore` lo excluye).

## 5. Operación

| Tarea | Comando (en `~/FabriHub`) |
|---|---|
| Actualizar a lo último de la rama | `sh scripts/deploy/deploy.sh` |
| Ver registros | `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production logs -f api caddy` |
| Estado | `... ps` (mismo prefijo) |
| Respaldos | `./backups/` (diario: 7 días, 4 semanas, 6 meses). Cópielos fuera del servidor: `scp -r ubuntu@217.71.200.20:~/FabriHub/backups .` |

**Nunca** use `down -v` en producción: borra la base de datos y los certificados.

## 6. Más adelante: dominio propio

1. En su DNS, un registro `A` de `fabrihub.sudominio.com` a `217.71.200.20`.
2. En `.env.production`: `DOMAIN=fabrihub.sudominio.com` y `APP_PUBLIC_URL=https://fabrihub.sudominio.com`.
3. `sh scripts/deploy/deploy.sh`. Caddy saca el certificado nuevo solo.
