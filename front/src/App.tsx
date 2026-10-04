/**
 * @project FabriHub - Front
 * @file src/App.tsx
 * @description Raíz de la aplicación: restaura la sesión y monta el router
 */

import AppRouter from "@navigation/AppRouter";
import { useRestoreSession } from "@navigation/useRestoreSession";

export default function App() {
  useRestoreSession();
  return <AppRouter />;
}
