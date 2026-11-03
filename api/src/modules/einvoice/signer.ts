/**
 * @project FabriHub - API
 * @file src/modules/einvoice/signer.ts
 * @description Firma XAdES-EPES de los comprobantes con la llave criptográfica (.p12) del ATV
 *
 * @overview
 * Firma envuelta (enveloped) con RSA-SHA256 y tres referencias SHA-256: el documento, el KeyInfo
 * y las SignedProperties, con la política de firma del Anexo 2 de la versión 4.4.
 * El documento llega ya canónico (xml.ts). Cada parte firmada se canonicaliza aquí a mano según
 * C14N 1.0 inclusivo: en un subárbol se escriben en su raíz todos los espacios de nombres que
 * hereda (el del comprobante, ds y, en las SignedProperties, xades).
 */

import { createHash, createSign, randomUUID } from "node:crypto";
import forge from "node-forge";
import { el } from "./xml.js";

const DS = "http://www.w3.org/2000/09/xmldsig#";
const XADES = "http://uri.etsi.org/01903/v1.3.2#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

/** Política de firma de la versión 4.4 (Anexo 2) y el SHA-256 del documento que la publica */
export const POLICY = {
  url: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf",
  digest: "DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8="
};

export interface SigningKey {
  privateKeyPem: string;
  certB64: string;
  certDigest: string;
  issuerName: string;
  serialNumber: string;
  modulus: string;
  exponent: string;
  subject: string;
  notBefore: Date;
  notAfter: Date;
}

export class SignerError extends Error {}

const sha256b64 = (data: string | Buffer) => createHash("sha256").update(data).digest("base64");

const DN_NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.5": "SERIALNUMBER",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.4": "SN",
  "2.5.4.42": "GIVENNAME"
};

/** Nombre distinguido en formato RFC 4514 (del atributo más específico al más general) */
function rfc4514(attrs: forge.pki.CertificateField[]): string {
  const esc = (v: string) => v.replace(/([\\,+"<>;=])/g, "\\$1").replace(/^([ #])/, "\\$1").replace(/ $/, "\\ ");
  return [...attrs]
    .reverse()
    .map((a) => `${DN_NAMES[a.type ?? ""] ?? a.type}=${esc(String(a.value))}`)
    .join(",");
}

/** Lee el .p12 del ATV: llave privada RSA y su certificado */
export function loadP12(p12: Buffer, pin: string): SigningKey {
  let store: forge.pkcs12.Pkcs12Pfx;
  try {
    store = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(p12.toString("binary"))), false, pin);
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    throw new SignerError(/mac|password|invalid/i.test(msg) ? "El PIN no corresponde a la llave criptográfica" : "El archivo no es una llave criptográfica .p12 válida");
  }
  const keyBag =
    store.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    store.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  const certBags = store.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const key = keyBag?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new SignerError("La llave criptográfica no contiene una llave privada");
  // El certificado del firmante es el que corresponde a la llave (el .p12 puede traer la cadena)
  const cert = certBags
    .map((b) => b.cert)
    .find((c): c is forge.pki.Certificate => Boolean(c) && (c!.publicKey as forge.pki.rsa.PublicKey).n?.equals(key.n));
  if (!cert) throw new SignerError("La llave criptográfica no contiene el certificado de la llave privada");
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
  const pub = cert.publicKey as forge.pki.rsa.PublicKey;
  const b64Int = (n: forge.jsbn.BigInteger) => {
    let hex = n.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    return Buffer.from(hex, "hex").toString("base64");
  };
  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certB64: der.toString("base64"),
    certDigest: sha256b64(der),
    issuerName: rfc4514(cert.issuer.attributes),
    serialNumber: BigInt(`0x${cert.serialNumber}`).toString(10),
    modulus: b64Int(pub.n),
    exponent: b64Int(pub.e),
    subject: rfc4514(cert.subject.attributes),
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter
  };
}

/**
 * @function signXml
 * @description Agrega la firma XAdES-EPES al final del comprobante (canónico, sin declaración XML).
 * @param signingTime fecha y hora con desplazamiento (misma zona que FechaEmision)
 * @returns el documento firmado, con la declaración XML
 */
export function signXml(xml: string, key: SigningKey, signingTime: string): string {
  const root = /^<([A-Za-z]+) xmlns="([^"]+)">/.exec(xml);
  if (!root) throw new SignerError("XML inesperado: falta el espacio de nombres del comprobante");
  const ns = root[2];
  const id = randomUUID();
  const sigId = `Signature-${id}`;
  const refId = `Reference-${id}`;
  const keyInfoId = `KeyInfoId-${sigId}`;
  const propsId = `SignedProperties-${sigId}`;

  // KeyInfo
  const keyInfoBody = [
    el("ds:X509Data", [el("ds:X509Certificate", key.certB64)]),
    el("ds:KeyValue", [el("ds:RSAKeyValue", [el("ds:Modulus", key.modulus), el("ds:Exponent", key.exponent)])])
  ];
  const keyInfo = el("ds:KeyInfo", keyInfoBody, [["Id", keyInfoId]]);
  const keyInfoC14n = el("ds:KeyInfo", keyInfoBody, [["xmlns", ns], ["xmlns:ds", DS], ["Id", keyInfoId]]);

  // SignedProperties
  const digest = (value: string) => [el("ds:DigestMethod", [], [["Algorithm", SHA256]]), el("ds:DigestValue", value)];
  const propsBody = [
    el("xades:SignedSignatureProperties", [
      el("xades:SigningTime", signingTime),
      el("xades:SigningCertificate", [
        el("xades:Cert", [
          el("xades:CertDigest", digest(key.certDigest)),
          el("xades:IssuerSerial", [el("ds:X509IssuerName", key.issuerName), el("ds:X509SerialNumber", key.serialNumber)])
        ])
      ]),
      el("xades:SignaturePolicyIdentifier", [
        el("xades:SignaturePolicyId", [
          el("xades:SigPolicyId", [el("xades:Identifier", POLICY.url)]),
          el("xades:SigPolicyHash", digest(POLICY.digest))
        ])
      ]),
      el("xades:SignerRole", [el("xades:ClaimedRoles", [el("xades:ClaimedRole", "ObligadoTributario")])])
    ]),
    el("xades:SignedDataObjectProperties", [
      el("xades:DataObjectFormat", [el("xades:MimeType", "text/xml"), el("xades:Encoding", "UTF-8")], [["ObjectReference", `#${refId}`]])
    ])
  ];
  const props = el("xades:SignedProperties", propsBody, [["Id", propsId]]);
  const propsC14n = el("xades:SignedProperties", propsBody, [["xmlns", ns], ["xmlns:ds", DS], ["xmlns:xades", XADES], ["Id", propsId]]);

  // SignedInfo
  const signedInfoBody = [
    el("ds:CanonicalizationMethod", [], [["Algorithm", C14N]]),
    el("ds:SignatureMethod", [], [["Algorithm", RSA_SHA256]]),
    el(
      "ds:Reference",
      [el("ds:Transforms", [el("ds:Transform", [], [["Algorithm", ENVELOPED]])]), ...digest(sha256b64(xml))],
      [["Id", refId], ["URI", ""]]
    ),
    el("ds:Reference", digest(sha256b64(keyInfoC14n)), [["Id", `ReferenceKeyInfo-${id}`], ["URI", `#${keyInfoId}`]]),
    el("ds:Reference", digest(sha256b64(propsC14n)), [["Type", "http://uri.etsi.org/01903#SignedProperties"], ["URI", `#${propsId}`]])
  ];
  const signedInfo = el("ds:SignedInfo", signedInfoBody);
  const signedInfoC14n = el("ds:SignedInfo", signedInfoBody, [["xmlns", ns], ["xmlns:ds", DS]]);
  const signatureValue = createSign("RSA-SHA256").update(signedInfoC14n).sign(key.privateKeyPem, "base64");

  const signature = el(
    "ds:Signature",
    [
      signedInfo,
      el("ds:SignatureValue", signatureValue, [["Id", `SignatureValue-${id}`]]),
      keyInfo,
      el("ds:Object", [el("xades:QualifyingProperties", [props], [["xmlns:xades", XADES], ["Id", `QualifyingProperties-${id}`], ["Target", `#${sigId}`]])])
    ],
    [["xmlns:ds", DS], ["Id", sigId]]
  );
  const close = `</${root[1]}>`;
  return `<?xml version="1.0" encoding="utf-8"?>${xml.slice(0, -close.length)}${signature}${close}`;
}
