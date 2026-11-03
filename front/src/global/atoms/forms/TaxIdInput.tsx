/**
 * @project FabriHub - Front
 * @file src/global/atoms/forms/TaxIdInput.tsx
 * @description Identificación fiscal según el país: tipo (RIF, cédula, DIMEX…) + número
 *
 * Al escribir, si el número corresponde claramente a otro tipo del país, el tipo cambia solo
 * («3101123456» en CR → cédula jurídica). Al salir del campo, el número queda normalizado.
 */

import { Group, Select, TextInput } from "@mantine/core";
import type { CompanyCountry } from "@auth/types";
import { canonicalTaxId, detectIdType, taxIdError } from "@modules/country/country";

interface Props {
  country: CompanyCountry;
  idType: string | null;
  value: string;
  onChange: (idType: string | null, value: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}

export default function TaxIdInput({ country, idType, value, onChange, label, required, disabled }: Readonly<Props>) {
  const type = country.idTypes.find((t) => t.code === idType) ?? null;
  const error = taxIdError(country, idType, value);
  return (
    <Group gap="xs" align="flex-start" grow preventGrowOverflow={false} wrap="nowrap">
      <Select
        label="Tipo"
        maw={170}
        data={country.idTypes.map((t) => ({ value: t.code, label: t.name }))}
        value={idType}
        onChange={(v) => onChange(v, value)}
        disabled={disabled}
        comboboxProps={{ withinPortal: true }}
      />
      <TextInput
        label={label ?? country.taxIdLabel}
        required={required}
        disabled={disabled}
        placeholder={type?.example ?? country.idTypes[0]?.example}
        value={value}
        error={error}
        onChange={(e) => {
          const v = e.currentTarget.value.toUpperCase();
          const detected = detectIdType(country, v);
          const keep = type && !taxIdError(country, type.code, v);
          onChange(keep || !detected ? idType : detected.code, v);
        }}
        onBlur={() => value && onChange(idType ?? detectIdType(country, value)?.code ?? null, canonicalTaxId(country, value))}
      />
    </Group>
  );
}
