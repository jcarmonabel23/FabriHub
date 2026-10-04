/**
 * @project FabriHub - Front
 * @file src/global/assets/theme.ts
 * @description Tema Mantine: base (colores, fuente, radio) + ajustes por componente
 */

import { createTheme, type MantineColorsTuple } from "@mantine/core";
import { themeBase } from "./theme/colors";

export const theme = createTheme({
  fontFamily: themeBase.fontFamily,
  headings: { fontFamily: themeBase.fontFamily },
  colors: { petrol: [...themeBase.colors.petrol] as unknown as MantineColorsTuple },
  primaryColor: themeBase.primaryColor,
  primaryShade: themeBase.primaryShade,
  defaultRadius: themeBase.defaultRadius,
  components: {
    Button: { defaultProps: { fw: 600 } },
    TextInput: { defaultProps: { radius: "md" } },
    PasswordInput: { defaultProps: { radius: "md" } },
    Select: { defaultProps: { radius: "md", allowDeselect: false } },
    Modal: { defaultProps: { radius: "lg", centered: true, overlayProps: { backgroundOpacity: 0.4, blur: 2 } } },
    Badge: { defaultProps: { radius: "sm", variant: "light" } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 200 } }
  }
});
