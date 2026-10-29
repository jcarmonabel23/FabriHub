/**
 * @project FabriHub - API
 * @file src/lib/storage.ts
 * @description Almacenamiento de objetos (contenido de los archivos subidos)
 *
 * @overview
 * Interfaz mínima para poder cambiar de disco local (volumen `uploads`) a un bucket S3/R2
 * sin tocar quien la usa. Las claves son rutas relativas `<empresa>/<archivo>/<variante>.<webp|png>`
 * generadas por la API (nunca por el cliente), y aun así se validan contra salirse del directorio.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { config } from "../config.js";

export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  /** null si no existe */
  get(key: string): Promise<Buffer | null>;
  /** Borra la clave y todo lo que cuelga de ella (un archivo con sus variantes) */
  remove(prefix: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}(\/[a-z0-9]+\.(webp|png))?$/;

function localStorage(root: string): Storage {
  const pathOf = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error(`Clave de almacenamiento inválida: ${key}`);
    const full = resolve(root, key);
    if (!full.startsWith(resolve(root) + sep)) throw new Error(`Clave fuera del almacenamiento: ${key}`);
    return full;
  };
  return {
    async put(key, data) {
      const full = pathOf(key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, data, { mode: 0o640 });
    },
    async get(key) {
      try {
        return await readFile(pathOf(key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async remove(prefix) {
      await rm(pathOf(prefix), { recursive: true, force: true });
    }
  };
}

export const storage: Storage = localStorage(config.UPLOADS_DIR);
