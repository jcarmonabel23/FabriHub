/**
 * @project FabriHub - Front
 * @file src/app/auth/otp-verify/Page.tsx
 * @description Segundo factor: código de 6 dígitos enviado al correo
 */

import { Alert, Anchor, Button, Center, Group, PinInput, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconMailCheck } from "@tabler/icons-react";
import { Navigate } from "react-router-dom";
import { useAuthHeader } from "@auth/context/AuthHeaderContext";
import { coreAuth } from "@auth/store/coreAuth";
import { useOtpVerifyLogic } from "./hooks/useOtpVerifyLogic";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function OtpVerifyPage() {
  const { challenge, code, setCode, verify, resend, error, terminal, isLoading, isResending, expiresIn, resendIn, backToSignIn } =
    useOtpVerifyLogic();

  const status = coreAuth((s) => s.status);

  useAuthHeader({ title: "Verificación en dos pasos", description: "Ingrese el código que enviamos a su correo" });

  // Sin desafío y sin sesión → volver al login. Con sesión recién abierta, el hook ya navega
  // (setTokens limpia el desafío; redirigir aquí ganaría la carrera y mandaría al login).
  if (!challenge) return status === "authenticated" ? null : <Navigate to="/auth/sign-in" replace />;

  return (
    <Stack gap="lg" className="mt-8">
      <Group gap="xs" justify="center" className="rounded-lg bg-brand-50 px-3 py-2">
        <IconMailCheck size={18} className="text-brand-700" />
        <Text size="sm" c="gray.7">
          Código enviado a <b>{challenge.destination}</b>
        </Text>
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} variant="light">
          {error}
        </Alert>
      )}

      <Center>
        <PinInput
          length={6}
          type="number"
          size="lg"
          oneTimeCode
          autoFocus
          value={code}
          onChange={setCode}
          onComplete={verify}
          disabled={isLoading || terminal || expiresIn === 0}
          aria-label="Código de verificación"
        />
      </Center>

      <Text size="xs" c={expiresIn > 0 ? "dimmed" : "red"} ta="center">
        {expiresIn > 0 ? `El código vence en ${mmss(expiresIn)}` : "El código venció. Solicite uno nuevo."}
      </Text>

      {terminal ? (
        <Button fullWidth onClick={backToSignIn}>
          Volver a iniciar sesión
        </Button>
      ) : (
        <Button fullWidth loading={isLoading} disabled={code.length !== 6} onClick={() => verify(code)}>
          Verificar
        </Button>
      )}

      {!terminal && (
        <Stack gap={4} align="center">
          <Text size="sm" c="dimmed">
            ¿No le llegó?{" "}
            <Anchor component="button" type="button" size="sm" fw={600} c="petrol.7" disabled={resendIn > 0 || isResending} onClick={resend}>
              {resendIn > 0 ? `Reenviar en ${resendIn} s` : "Reenviar código"}
            </Anchor>
          </Text>
          <Anchor component="button" type="button" size="sm" c="dimmed" onClick={backToSignIn}>
            Usar otra cuenta
          </Anchor>
        </Stack>
      )}
    </Stack>
  );
}
