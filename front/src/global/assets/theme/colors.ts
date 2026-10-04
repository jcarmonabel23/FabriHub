/**
 * @project FabriHub - Front
 * @file src/global/assets/theme/colors.ts
 * @description Paleta y configuración base del tema Mantine
 *
 * @overview
 * Misma base que DaviHub (Montserrat, defaultRadius md) con paleta propia "petrol" (azul
 * petróleo industrial). Para volver al rojo de DaviHub basta cambiar `primaryColor`.
 * Los mismos tonos se exponen a Tailwind como `brand-*` en index.css.
 */

export const themeColors = {
  petrol: [
    "#e8f6f8",
    "#d2e9ee",
    "#a6d2dc",
    "#76bac9",
    "#4fa5b9",
    "#3797ae",
    "#288fa9",
    "#167c94",
    "#036e85",
    "#005f74"
  ] as const
};

export const themeBase = {
  fontFamily: "Montserrat, sans-serif",
  colors: themeColors,
  primaryColor: "petrol" as const,
  primaryShade: 7 as const,
  defaultRadius: "md" as const
};
