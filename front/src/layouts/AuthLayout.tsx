/**
 * @project FabriHub - Front
 * @file src/layouts/AuthLayout.tsx
 * @description Layout de autenticación: tarjeta centrada sobre degradado (estructura DaviHub)
 */

import { Outlet } from "react-router-dom";
import { Logo } from "@atoms/brand/Logo";
import AppVersion from "@atoms/version/AppVersion";
import { AuthHeaderProvider, useAuthHeaderValue } from "@auth/context/AuthHeaderContext";

function AuthHeader() {
  const { title, description } = useAuthHeaderValue();
  return (
    <div className="text-center">
      <Logo size={44} className="justify-center mb-6" />
      <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
      {description && <p className="mt-2 text-sm text-gray-500">{description}</p>}
    </div>
  );
}

export default function AuthLayout() {
  return (
    <AuthHeaderProvider>
      <section className="min-h-screen flex items-center justify-center bg-linear-to-b from-brand-50 to-white px-4">
        <div className="max-w-md w-full space-y-8 p-10 bg-white rounded-xl shadow-xl">
          <AuthHeader />
          <Outlet />
        </div>
      </section>
      <AppVersion />
    </AuthHeaderProvider>
  );
}
