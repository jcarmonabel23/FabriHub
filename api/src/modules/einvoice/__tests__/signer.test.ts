/**
 * @project FabriHub - API
 * @file src/modules/einvoice/__tests__/signer.test.ts
 * @description XML 4.4 y firma XAdES-EPES con la llave de prueba (autofirmada, PIN 1234) de las pruebas de humo
 */

import { createHash, createVerify, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POLICY, SignerError, loadP12, signXml } from "../signer.js";
import { buildXml, escText, totalsOf, type Comprobante, type Line } from "../xml.js";

const P12 = readFileSync(new URL("../../../../../scripts/smoke/fixtures/einvoice-test.p12", import.meta.url));

const line = (over: Partial<Line> = {}): Line => ({
  cabys: "8314100000100",
  code: "SRV-1",
  quantity: 1,
  unit: "Sp",
  detail: "Soporte técnico",
  unitPrice: 10000,
  amount: 10000,
  discount: 0,
  rateCode: "08",
  rate: 13,
  tax: 1300,
  isService: true,
  ...over
});

const doc = (over: Partial<Comprobante> = {}): Comprobante => ({
  type: "TE",
  clave: "50603112600310112345600100001040000000001100000001",
  consecutive: "00100001040000000001",
  providerId: "3101123456",
  activityCode: "620100",
  issuedAt: "2026-11-03T10:15:00-06:00",
  issuer: {
    name: "Tienda & Cía",
    idType: "02",
    id: "3101123456",
    email: "fe@tienda.cr",
    location: { province: 1, canton: "01", district: "01", otherSigns: "Frente al parque" }
  },
  receiver: null,
  saleCondition: "01",
  lines: [line()],
  currency: { code: "CRC", rate: 1 },
  payments: [{ code: "01", amount: 11300 }],
  ...over
});

describe("xml", () => {
  it("separa gravado y exento, servicios y mercancías", () => {
    const t = totalsOf([line({ discount: 1000, tax: 1170 }), line({ isService: false, rateCode: "10", rate: 0, tax: 0, amount: 500, unitPrice: 500 })]);
    expect(t).toMatchObject({ servTaxed: 10000, goodsExempt: 500, sale: 10500, discounts: 1000, net: 9500, tax: 1170, total: 10670 });
  });

  it("escapa el texto y escribe la raíz con su espacio de nombres", () => {
    const { xml } = buildXml(doc());
    expect(xml.startsWith('<TiqueteElectronico xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico">')).toBe(true);
    expect(xml).toContain(`<Nombre>${escText("Tienda & Cía")}</Nombre>`);
    expect(xml).not.toMatch(/<[^>]+\/>/); // sin etiquetas vacías abreviadas (forma canónica)
  });

  it("la nota de crédito referencia al comprobante que anula", () => {
    const { xml } = buildXml(
      doc({ type: "NC", reference: { docType: "FE", clave: "5".repeat(50), issuedAt: "2026-11-03T09:00:00-06:00", code: "01", reason: "Devolución" } })
    );
    expect(xml).toContain(`<InformacionReferencia><TipoDocIR>01</TipoDocIR><Numero>${"5".repeat(50)}</Numero>`);
  });
});

describe("signer", () => {
  it("rechaza un PIN incorrecto", () => {
    expect(() => loadP12(P12, "0000")).toThrow(SignerError);
  });

  it("firma: digest del documento, RSA-SHA256 sobre SignedInfo y política 4.4", () => {
    const key = loadP12(P12, "1234");
    const { xml } = buildXml(doc());
    const signed = signXml(xml, key, "2026-11-03T10:15:01-06:00");
    expect(signed.startsWith('<?xml version="1.0" encoding="utf-8"?><TiqueteElectronico ')).toBe(true);

    const body = signed.replace(/^<\?xml[^>]*\?>/, "").replace(/<ds:Signature [\s\S]*<\/ds:Signature>/, "");
    expect(body).toBe(xml);
    const docDigest = /URI="">[\s\S]*?<ds:DigestValue>([^<]+)</.exec(signed)![1];
    expect(createHash("sha256").update(body).digest("base64")).toBe(docDigest);

    const signedInfo = /<ds:SignedInfo>[\s\S]*?<\/ds:SignedInfo>/.exec(signed)![0].replace(
      "<ds:SignedInfo>",
      '<ds:SignedInfo xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">'
    );
    const value = /<ds:SignatureValue[^>]*>([^<]+)</.exec(signed)![1];
    const cert = new X509Certificate(Buffer.from(key.certB64, "base64"));
    expect(createVerify("RSA-SHA256").update(signedInfo).verify(cert.publicKey, value, "base64")).toBe(true);
    expect(signed).toContain(`<xades:Identifier>${POLICY.url}</xades:Identifier>`);
    expect(signed).toContain(`<ds:DigestValue>${POLICY.digest}</ds:DigestValue>`);
  });
});
