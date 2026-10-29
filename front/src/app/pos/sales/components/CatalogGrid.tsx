/**
 * @project FabriHub - Front
 * @file src/app/pos/sales/components/CatalogGrid.tsx
 * @description Catálogo de la caja: búsqueda, lector de código de barras y tarjetas con foto
 *
 * El lector de código de barras «escribe» el código y pulsa Enter: si coincide exacto con un código
 * de barras o de producto, se agrega y el buscador queda listo para el siguiente. «3*código» agrega 3.
 * Los precios se muestran con IVA (como en el anaquel); el total definitivo lo calcula el servidor.
 */

import { forwardRef, useState } from "react";
import { Badge, Card, Center, Image, Loader, ScrollArea, SimpleGrid, Text, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconBarcode, IconPackage } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { fmtMoney } from "@utils/format";
import { notifyError } from "@utils/notify";
import { posApi } from "../../services/pos.service";
import type { CatalogItem } from "../../types";

interface Props {
  terminalId: string;
  inCart: (productId: string) => number;
  onAdd: (item: CatalogItem, quantity: number) => void;
}

/** «3*780123» → { qty: 3, term: "780123" } */
function parseScan(raw: string): { qty: number; term: string } {
  const m = /^(\d+(?:[.,]\d+)?)\s*\*\s*(.+)$/.exec(raw.trim());
  if (!m) return { qty: 1, term: raw.trim() };
  return { qty: Number(m[1].replace(",", ".")) || 1, term: m[2].trim() };
}

const withTax = (p: CatalogItem) => (p.price === null ? null : Math.round(p.price * (1 + p.taxRate / 100) * 100) / 100);

const CatalogGrid = forwardRef<HTMLInputElement, Props>(function CatalogGrid({ terminalId, inCart, onAdd }, ref) {
  const [raw, setRaw] = useState("");
  const { term } = parseScan(raw);
  const [debounced] = useDebouncedValue(term, 250);
  const list = useQuery({
    queryKey: ["pos", "catalog", terminalId, debounced],
    queryFn: () => posApi.catalog(terminalId, debounced),
    placeholderData: (prev) => prev
  });

  const add = (item: CatalogItem, qty: number) => {
    if (item.price === null) {
      notifyError(new Error(`${item.code} no tiene precio en la lista de la caja ni precio de referencia`), "Sin precio");
      return;
    }
    onAdd(item, qty);
  };

  /** Enter: coincidencia exacta (código de barras o código) o único resultado */
  const onEnter = async () => {
    const { qty, term: t } = parseScan(raw);
    if (!t) return;
    const results = await posApi.catalog(terminalId, t).catch((err) => {
      notifyError(err);
      return [] as CatalogItem[];
    });
    const exact = results.find((p) => p.barcode === t || p.code.toUpperCase() === t.toUpperCase());
    const pick = exact ?? (results.length === 1 ? results[0] : null);
    if (pick) {
      add(pick, qty);
      setRaw("");
    } else if (!results.length) {
      notifyError(new Error(`No hay productos que coincidan con «${t}»`), "No encontrado");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TextInput
        ref={ref}
        size="md"
        autoFocus
        placeholder="Buscar por nombre o código, o escanear el código de barras (F2)"
        leftSection={<IconBarcode size={20} />}
        rightSection={list.isFetching ? <Loader size="xs" /> : null}
        value={raw}
        onChange={(e) => setRaw(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void onEnter();
          } else if (e.key === "Escape") setRaw("");
        }}
      />
      <ScrollArea className="min-h-0 flex-1" offsetScrollbars>
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 4, xl: 5 }} spacing="sm">
          {(list.data ?? []).map((p) => {
            const qty = inCart(p.id);
            const left = p.available === null ? null : p.available - qty;
            const price = withTax(p);
            return (
              <Card
                key={p.id}
                withBorder
                radius="md"
                padding="xs"
                component="button"
                type="button"
                onClick={() => add(p, 1)}
                className={`text-left transition hover:shadow-md ${qty ? "ring-2 ring-[var(--mantine-color-petrol-5,#167c94)]" : ""}`}
                aria-label={`Agregar ${p.name}`}
              >
                <Card.Section className="relative bg-gray-50">
                  <Center h={96}>
                  {p.image ? <Image src={p.image.medium} alt="" h={96} fit="contain" /> : <IconPackage size={40} className="text-gray-300" />}
                  </Center>
                  {qty > 0 && (
                    <Badge className="absolute right-1 top-1" size="lg" circle>
                      {qty}
                    </Badge>
                  )}
                  {p.isPromo && (
                    <Badge className="absolute left-1 top-1" size="xs" color="orange">
                      Oferta
                    </Badge>
                  )}
                </Card.Section>
                <Text size="xs" c="dimmed" mt={6}>
                  {p.code}
                </Text>
                <Text size="sm" fw={600} lineClamp={2} h={40}>
                  {p.name}
                </Text>
                <div className="mt-1 flex items-end justify-between gap-1">
                  <Text fw={700} size="md">
                    {price === null ? "Sin precio" : fmtMoney(price)}
                  </Text>
                  {left !== null && (
                    <Badge size="xs" variant="light" color={left > 0 ? "teal" : "red"}>
                      {left > 0 ? `${fmtMoney(left, 0)} ${p.unitCode}` : "Agotado"}
                    </Badge>
                  )}
                </div>
                <Text size="10px" c="dimmed">
                  {p.taxRate ? `IVA ${p.taxRate}% incl.` : "Exento"}
                </Text>
              </Card>
            );
          })}
        </SimpleGrid>
        {!list.isLoading && !list.data?.length && (
          <Text c="dimmed" ta="center" mt="xl">
            Sin productos {debounced ? `para «${debounced}»` : "vendibles"}
          </Text>
        )}
      </ScrollArea>
    </div>
  );
});

export default CatalogGrid;
