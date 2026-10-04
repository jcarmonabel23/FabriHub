/**
 * @project FabriHub - Front
 * @file src/main.tsx
 * @description Punto de entrada: Router, React Query, Mantine (tema, modales, notificaciones, fechas)
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "dayjs/locale/es";
import { theme } from "@assets/theme";
import "@assets/index.css";
import { ApiError } from "@clients/apiClient";
import App from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Un 401/403 no se arregla reintentando
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2
    }
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <MantineProvider theme={theme}>
          <DatesProvider settings={{ locale: "es", firstDayOfWeek: 1 }}>
            <ModalsProvider labels={{ confirm: "Confirmar", cancel: "Cancelar" }}>
              <Notifications position="top-right" zIndex={2000} />
              <App />
            </ModalsProvider>
          </DatesProvider>
        </MantineProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
);
