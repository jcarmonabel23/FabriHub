/**
 * @project FabriHub - Front
 * @file src/app/pos/sales/Page.tsx
 * @description Punto de venta → Ventas de mostrador (POS_SALES): la caja
 *
 * Sin turno abierto, pide abrir uno. Con turno: catálogo con fotos a la izquierda y ticket en vivo a
 * la derecha. Cada cambio de la cuenta se cotiza en el servidor (precio de la lista de la caja, IVA y
 * descuentos); el cobro confirma la venta en una sola transacción y descuenta el inventario.
 * Atajos: F2 buscar, F9 cobrar. Quien solo puede consultar va a los comprobantes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Group, Loader, Text } from "@mantine/core";
import { useDebouncedValue, useHotkeys } from "@mantine/hooks";
import { IconLockOpen } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime, fmtMoney } from "@utils/format";
import CloseSessionModal from "../components/CloseSessionModal";
import { POS_ACTIONS } from "../posActions";
import { posApi } from "../services/pos.service";
import { useCart } from "../store/cart";
import type { PosSale, QuoteInput } from "../types";
import CartPanel from "./components/CartPanel";
import CatalogGrid from "./components/CatalogGrid";
import OpenSessionPanel from "./components/OpenSessionPanel";
import PaymentModal from "./components/PaymentModal";
import SaleDoneModal from "./components/SaleDoneModal";

export default function PosSalesPage() {
  const can = useCan("POS_SALES");
  const canSessions = useCan("POS_SESSIONS");
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["pos", "me"], queryFn: posApi.me, enabled: can("add_new") });
  const session = me.data?.session ?? null;

  const cart = useCart();
  const { bindSession } = cart;
  useEffect(() => {
    if (session) bindSession(session.id);
  }, [session, bindSession]);

  const searchRef = useRef<HTMLInputElement>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<PosSale | null>(null);
  const [closing, setClosing] = useState(false);

  // Cotización de la cuenta (sin pagos): se rehace con cada cambio
  const input = useMemo<QuoteInput | null>(
    () =>
      session && cart.sessionId === session.id && cart.lines.length
        ? {
            sessionId: session.id,
            customerId: cart.customer?.id ?? null,
            discountPct: cart.discountPct,
            lines: cart.lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity, discountPct: l.discountPct }))
          }
        : null,
    [session, cart.sessionId, cart.lines, cart.customer, cart.discountPct]
  );
  const [debounced] = useDebouncedValue(input, 200);
  const quote = useQuery({
    queryKey: ["pos", "quote", debounced],
    queryFn: () => posApi.quote(debounced!),
    enabled: Boolean(debounced),
    placeholderData: (prev) => prev,
    retry: false
  });

  const readyToPay = Boolean(input && quote.data && !quote.isFetching && !quote.error && quote.data.lines.length === cart.lines.length);
  useHotkeys(
    [
      ["F2", () => searchRef.current?.focus()],
      ["F9", () => readyToPay && !paying && setPaying(true)]
    ],
    [] // también dentro del buscador (por defecto se ignoran los campos de texto)
  );

  if (!can("add_new")) return <Navigate to="/pos/sales/tickets" replace />;
  if (me.isLoading || !me.data) {
    return (
      <div className="flex justify-center p-10">
        <Loader />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6">
        <ModuleHeader title="Ventas de mostrador" description="Abra un turno para vender" actions={POS_ACTIONS} />
        <OpenSessionPanel me={me.data} canOpen={canSessions("add_new")} />
      </div>
    );
  }

  const inCart = (productId: string) => cart.lines.find((l) => l.productId === productId)?.quantity ?? 0;
  const afterSale = (sale: PosSale) => {
    setPaying(false);
    setDone(sale);
    cart.clear();
    qc.invalidateQueries({ queryKey: ["pos", "catalog"] });
    qc.invalidateQueries({ queryKey: ["pos", "me"] });
  };

  return (
    <div className="flex h-[calc(100dvh-64px)] min-h-[560px] flex-col gap-3 p-4">
      <ModuleHeader
        title={`Caja ${session.terminalCode}`}
        description={`${session.terminalName} · turno ${session.number} · ${session.cashierName} · desde ${fmtDateTime(session.openedAt)}`}
        actions={POS_ACTIONS}
        right={
          <Group gap="xs">
            <Badge size="lg" variant="light" color="teal">
              {session.totals.completed} venta(s) · {fmtMoney(session.totals.grandTotal)}
            </Badge>
            {canSessions("close") && (
              <Button variant="default" color="red" leftSection={<IconLockOpen size={16} />} onClick={() => setClosing(true)}>
                Cerrar turno
              </Button>
            )}
          </Group>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_420px]">
        <CatalogGrid ref={searchRef} terminalId={session.terminalId} inCart={inCart} onAdd={(item, qty) => cart.add(item, qty)} />
        <CartPanel
          quote={input ? quote.data : undefined}
          quoting={quote.isFetching || input !== debounced}
          quoteError={input && quote.error ? (quote.error as Error).message : null}
          maxDiscountPct={me.data.settings.maxDiscountPct}
          onPay={() => setPaying(true)}
        />
      </div>
      {input && (
        <PaymentModal
          opened={paying}
          onClose={() => setPaying(false)}
          base={input}
          currencies={me.data.currencies}
          settings={me.data.settings}
          isSupervisor={can("approve")}
          onSold={afterSale}
        />
      )}
      <SaleDoneModal
        sale={done}
        onClose={() => {
          setDone(null);
          searchRef.current?.focus();
        }}
      />
      <CloseSessionModal sessionId={closing ? session.id : null} onClose={() => setClosing(false)} />
      <Text size="xs" c="dimmed" ta="center">
        F2 buscar · F9 cobrar · «3*código» agrega 3 unidades · el comprobante no es una factura fiscal
      </Text>
    </div>
  );
}
