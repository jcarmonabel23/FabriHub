// Aplica el modo claro/oscuro guardado antes de pintar, para evitar el destello blanco.
// Archivo aparte (no inline) porque la CSP solo admite scripts de 'self'.
try {
  var v = localStorage.getItem("mantine-color-scheme-value");
  if (v === "auto") v = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.setAttribute("data-mantine-color-scheme", v === "dark" ? "dark" : "light");
} catch (e) {}
