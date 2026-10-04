/**
 * @project FabriHub - Front
 * @file src/app/inventory/components/ProductSelect.tsx
 * @description Buscador de productos por código o nombre (consulta /lookups/products con debounce)
 */

import { useEffect, useMemo, useState } from "react";
import { Loader, Select, type SelectProps } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { inventoryApi } from "../services/inventory.service";
import type { ProductOption } from "../types";

interface Props extends Omit<SelectProps, "data" | "value" | "onChange"> {
  value: ProductOption | null;
  onChange: (p: ProductOption | null) => void;
  stockable?: boolean;
  /** Solo productos que se compran / venden / fabrican */
  only?: "purchased" | "sold" | "manufactured";
  excludeIds?: string[];
}

export default function ProductSelect({ value, onChange, stockable, only, excludeIds, ...rest }: Readonly<Props>) {
  const [search, setSearch] = useState(value ? `${value.code} · ${value.name}` : "");
  const [debounced] = useDebouncedValue(search, 300);
  useEffect(() => setSearch(value ? `${value.code} · ${value.name}` : ""), [value]);

  const term = value && search === `${value.code} · ${value.name}` ? "" : debounced;
  const results = useQuery({
    queryKey: ["lookup", "products", term, stockable, only],
    queryFn: () => inventoryApi.searchProducts(term, stockable, only),
    staleTime: 60_000
  });

  const options = useMemo(() => {
    const list = [...(results.data ?? [])];
    if (value && !list.some((p) => p.id === value.id)) list.unshift(value);
    return list.filter((p) => !excludeIds?.includes(p.id) || p.id === value?.id);
  }, [results.data, value, excludeIds]);

  return (
    <Select
      searchable
      clearable
      nothingFoundMessage="Sin coincidencias"
      placeholder="Buscar por código o nombre"
      rightSection={results.isFetching ? <Loader size={14} /> : undefined}
      {...rest}
      filter={({ options: o }) => o}
      data={options.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
      value={value?.id ?? null}
      searchValue={search}
      onSearchChange={setSearch}
      onChange={(id) => onChange(options.find((p) => p.id === id) ?? null)}
    />
  );
}
