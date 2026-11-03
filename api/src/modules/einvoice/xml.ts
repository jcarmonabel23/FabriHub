/**
 * @project FabriHub - API
 * @file src/modules/einvoice/xml.ts
 * @description XML 4.4 de los comprobantes electrónicos de Costa Rica (tiquete, factura y nota de crédito)
 *
 * @overview
 * El XML se escribe directamente en su forma canónica (C14N 1.0): sin declaraciones repetidas, sin
 * etiquetas vacías abreviadas, atributos en orden y sin espacios entre elementos. Así el texto que se
 * firma es exactamente el que se envía y el firmador no necesita un canonicalizador general.
 * El orden de los elementos sigue los XSD oficiales v4.4.
 */

export const NS: Record<DocType, string> = {
  FE: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica",
  TE: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico",
  NC: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica"
};

const ROOT: Record<DocType, string> = { FE: "FacturaElectronica", TE: "TiqueteElectronico", NC: "NotaCreditoElectronica" };

/** Código de tipo de comprobante en el consecutivo y en InformacionReferencia */
export const DOC_CODE: Record<DocType, string> = { FE: "01", NC: "03", TE: "04" };

export type DocType = "FE" | "TE" | "NC";

// ------------------------------------------------------------------ Serialización canónica

/** Texto de un nodo según C14N: &, <, > y \r */
export const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");

/** Valor de atributo según C14N: &, <, ", \t, \n y \r */
export const escAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");

type Child = string | null | undefined | false;

/**
 * Elemento canónico. `attrs` en el orden en que deben salir (declaraciones de espacio de nombres
 * primero; luego los atributos sin prefijo por nombre). Un texto se pasa como `text(...)`.
 */
export function el(name: string, children: Child[] | string, attrs: [string, string][] = []): string {
  const a = attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  const body = typeof children === "string" ? escText(children) : children.filter(Boolean).join("");
  return `<${name}${a}>${body}</${name}>`;
}

/** Importe con 5 decimales (DecimalDineroType) */
export const money = (n: number) => (Math.round(n * 100000) / 100000).toFixed(5);
const qty = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);

/** Recorta a la longitud máxima del XSD sin cortar un par sustituto */
const cut = (s: string, max: number) => Array.from(s.trim()).slice(0, max).join("");

// ------------------------------------------------------------------ Datos del comprobante

export interface Party {
  name: string;
  /** 01 física, 02 jurídica, 03 DIMEX, 04 NITE, 05 extranjero no domiciliado */
  idType: string;
  id: string;
  tradeName?: string | null;
  email?: string | null;
  phone?: { country: string; number: string } | null;
}

export interface Location {
  province: number;
  canton: string;
  district: string;
  neighborhood?: string | null;
  otherSigns: string;
}

export interface Line {
  cabys: string;
  code: string;
  quantity: number;
  unit: string;
  detail: string;
  unitPrice: number;
  /** Cantidad × precio (antes del descuento) */
  amount: number;
  discount: number;
  /** Código de tarifa del IVA (01 = 0 %, 08 = 13 %, 10 = exenta…) */
  rateCode: string;
  rate: number;
  tax: number;
  isService: boolean;
}

export interface Reference {
  docType: DocType;
  clave: string;
  issuedAt: string;
  /** 01 = anula el documento de referencia */
  code: string;
  reason: string;
}

export interface Comprobante {
  type: DocType;
  clave: string;
  consecutive: string;
  providerId: string;
  activityCode: string;
  /** Fecha y hora con desplazamiento (2026-11-06T10:15:00-06:00) */
  issuedAt: string;
  issuer: Party & { location: Location };
  receiver: Party | null;
  /** 01 = contado */
  saleCondition: string;
  lines: Line[];
  currency: { code: string; rate: number };
  /** Medio de pago (01 efectivo, 02 tarjeta, 04 transferencia, 06 SINPE Móvil) → monto */
  payments: { code: string; amount: number }[];
  reference?: Reference | null;
}

/** Tarifa 10 = exenta; las demás (incluida la 0 %) son gravadas */
const isExempt = (l: Line) => l.rateCode === "10";

export interface Totals {
  servTaxed: number;
  servExempt: number;
  goodsTaxed: number;
  goodsExempt: number;
  taxed: number;
  exempt: number;
  sale: number;
  discounts: number;
  net: number;
  taxes: { rateCode: string; amount: number }[];
  tax: number;
  total: number;
}

const r5 = (n: number) => Math.round(n * 100000) / 100000;

export function totalsOf(lines: Line[]): Totals {
  const sum = (f: (l: Line) => boolean) => r5(lines.filter(f).reduce((a, l) => a + l.amount, 0));
  const servTaxed = sum((l) => l.isService && !isExempt(l));
  const servExempt = sum((l) => l.isService && isExempt(l));
  const goodsTaxed = sum((l) => !l.isService && !isExempt(l));
  const goodsExempt = sum((l) => !l.isService && isExempt(l));
  const discounts = r5(lines.reduce((a, l) => a + l.discount, 0));
  const byRate = new Map<string, number>();
  for (const l of lines) byRate.set(l.rateCode, r5((byRate.get(l.rateCode) ?? 0) + l.tax));
  const taxes = [...byRate].sort(([a], [b]) => a.localeCompare(b)).map(([rateCode, amount]) => ({ rateCode, amount }));
  const tax = r5(taxes.reduce((a, t) => a + t.amount, 0));
  const sale = r5(servTaxed + servExempt + goodsTaxed + goodsExempt);
  const net = r5(sale - discounts);
  return {
    servTaxed,
    servExempt,
    goodsTaxed,
    goodsExempt,
    taxed: r5(servTaxed + goodsTaxed),
    exempt: r5(servExempt + goodsExempt),
    sale,
    discounts,
    net,
    taxes,
    tax,
    total: r5(net + tax)
  };
}

// ------------------------------------------------------------------ Armado

function identification(p: Party) {
  return el("Identificacion", [el("Tipo", p.idType), el("Numero", p.id)]);
}

function issuerXml(p: Comprobante["issuer"]) {
  const loc = p.location;
  return el("Emisor", [
    el("Nombre", cut(p.name, 100)),
    identification(p),
    p.tradeName ? el("NombreComercial", cut(p.tradeName, 80)) : null,
    el("Ubicacion", [
      el("Provincia", String(loc.province)),
      el("Canton", loc.canton),
      el("Distrito", loc.district),
      loc.neighborhood && loc.neighborhood.trim().length >= 5 ? el("Barrio", cut(loc.neighborhood, 50)) : null,
      el("OtrasSenas", cut(loc.otherSigns, 250))
    ]),
    p.phone ? el("Telefono", [el("CodigoPais", p.phone.country), el("NumTelefono", p.phone.number)]) : null,
    el("CorreoElectronico", cut(p.email ?? "", 160))
  ]);
}

function receiverXml(p: Party) {
  return el("Receptor", [
    el("Nombre", cut(p.name, 100)),
    identification(p),
    p.tradeName ? el("NombreComercial", cut(p.tradeName, 80)) : null,
    p.email ? el("CorreoElectronico", cut(p.email, 160)) : null
  ]);
}

function lineXml(l: Line, n: number) {
  const subtotal = r5(l.amount - l.discount);
  return el("LineaDetalle", [
    el("NumeroLinea", String(n)),
    el("CodigoCABYS", l.cabys),
    el("CodigoComercial", [el("Tipo", "01"), el("Codigo", cut(l.code, 20))]),
    el("Cantidad", qty(l.quantity)),
    el("UnidadMedida", l.unit),
    el("Detalle", cut(l.detail, 200)),
    el("PrecioUnitario", money(l.unitPrice)),
    el("MontoTotal", money(l.amount)),
    l.discount > 0
      ? el("Descuento", [el("MontoDescuento", money(l.discount)), el("CodigoDescuento", "07")])
      : null,
    el("SubTotal", money(subtotal)),
    el("BaseImponible", money(subtotal)),
    el("Impuesto", [el("Codigo", "01"), el("CodigoTarifaIVA", l.rateCode), el("Tarifa", l.rate.toFixed(2)), el("Monto", money(l.tax))]),
    el("ImpuestoAsumidoEmisorFabrica", money(0)),
    el("ImpuestoNeto", money(l.tax)),
    el("MontoTotalLinea", money(subtotal + l.tax))
  ]);
}

function summaryXml(c: Comprobante, t: Totals) {
  const nz = (name: string, v: number) => (v > 0 ? el(name, money(v)) : null);
  return el("ResumenFactura", [
    el("CodigoTipoMoneda", [el("CodigoMoneda", c.currency.code), el("TipoCambio", money(c.currency.rate))]),
    nz("TotalServGravados", t.servTaxed),
    nz("TotalServExentos", t.servExempt),
    nz("TotalMercanciasGravadas", t.goodsTaxed),
    nz("TotalMercanciasExentas", t.goodsExempt),
    nz("TotalGravado", t.taxed),
    nz("TotalExento", t.exempt),
    el("TotalVenta", money(t.sale)),
    nz("TotalDescuentos", t.discounts),
    el("TotalVentaNeta", money(t.net)),
    ...t.taxes.map((x) => el("TotalDesgloseImpuesto", [el("Codigo", "01"), el("CodigoTarifaIVA", x.rateCode), el("TotalMontoImpuesto", money(x.amount))])),
    el("TotalImpuesto", money(t.tax)),
    ...c.payments.slice(0, 4).map((p) => el("MedioPago", [el("TipoMedioPago", p.code), el("TotalMedioPago", money(p.amount))])),
    el("TotalComprobante", money(t.total))
  ]);
}

/** Raíz canónica del comprobante, sin firma ni declaración XML */
export function buildXml(c: Comprobante): { xml: string; totals: Totals } {
  const totals = totalsOf(c.lines);
  const ref = c.reference;
  const xml = el(
    ROOT[c.type],
    [
      el("Clave", c.clave),
      el("ProveedorSistemas", cut(c.providerId, 20)),
      el("CodigoActividadEmisor", c.activityCode),
      el("NumeroConsecutivo", c.consecutive),
      el("FechaEmision", c.issuedAt),
      issuerXml(c.issuer),
      c.receiver ? receiverXml(c.receiver) : null,
      el("CondicionVenta", c.saleCondition),
      el("DetalleServicio", c.lines.map((l, i) => lineXml(l, i + 1))),
      summaryXml(c, totals),
      ref
        ? el("InformacionReferencia", [
            el("TipoDocIR", DOC_CODE[ref.docType]),
            el("Numero", ref.clave),
            el("FechaEmisionIR", ref.issuedAt),
            el("Codigo", ref.code),
            el("Razon", cut(ref.reason, 180))
          ])
        : null
    ],
    [["xmlns", NS[c.type]]]
  );
  return { xml, totals };
}

/** Lee el estado y el detalle de un MensajeHacienda (XML) */
export function parseMensajeHacienda(xml: string): { status: string | null; detail: string | null } {
  const tag = (name: string) => {
    const m = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
    return m ? m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim() : null;
  };
  const code = tag("Mensaje");
  return { status: code === "1" || code === "2" ? "accepted" : code === "3" ? "rejected" : null, detail: tag("DetalleMensaje") };
}
