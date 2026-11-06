import { describe, expect, it } from "vitest";
import { daysIn, ddmm, eachDay, groupSum, pctChange, previousRange, ratio, sum, sumUsd, usdOf, weekday } from "../types";

describe("previousRange", () => {
  it("un día se compara con el mismo día de la semana pasada", () => {
    expect(previousRange("2026-11-05", "2026-11-05")).toEqual({ from: "2026-10-29", to: "2026-10-29" });
  });
  it("menos de una semana: los mismos días de la semana anterior", () => {
    expect(previousRange("2026-11-02", "2026-11-04")).toEqual({ from: "2026-10-26", to: "2026-10-28" });
  });
  it("una semana o más: el período de igual duración inmediatamente anterior", () => {
    expect(previousRange("2026-11-01", "2026-11-30")).toEqual({ from: "2026-10-02", to: "2026-10-31" });
  });
});

describe("fechas", () => {
  it("daysIn cuenta ambos extremos y eachDay los recorre", () => {
    expect(daysIn("2026-10-30", "2026-11-02")).toBe(4);
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
  it("ddmm para los ejes", () => {
    expect(ddmm("2026-11-05")).toBe("05/11");
  });
  it("weekday en español", () => {
    expect(weekday("2026-11-05")).toBe("Jueves");
  });
});

describe("sumas", () => {
  const rows = [
    { net: 365, _usd: 36.5 },
    { net: 100, _usd: 50 },
    { net: 10, _usd: null }
  ];
  it("sum ignora vacíos", () => {
    expect(sum([...rows, { net: null }], "net")).toBe(475);
  });
  it("sumUsd usa la tasa de cada fila y omite las que no la tienen", () => {
    expect(sumUsd(rows, "net")).toBe(12);
    expect(sumUsd([{ net: 5 }], "net")).toBeNull();
  });
  it("pctChange contra una base negativa usa su valor absoluto", () => {
    expect(pctChange(150, 100)).toBe(0.5);
    expect(pctChange(-50, -100)).toBe(0.5);
    expect(pctChange(5, 0)).toBeNull();
  });
  it("usdOf sin tasa es null", () => {
    expect(usdOf(365, 36.5)).toBe(10);
    expect(usdOf(365, null)).toBeNull();
  });
  it("ratio sin divisor es null", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
  });
});

describe("groupSum", () => {
  const rows = [
    { k: "B", v: 2 },
    { k: "A", v: 1 },
    { k: "B", v: 3.333 },
    { k: "C", v: 9 }
  ];
  it("agrupa, ordena y recorta", () => {
    expect(groupSum(rows, "k", ["v"], { sortBy: "v", top: 2 })).toEqual([
      { label: "C", v: 9 },
      { label: "B", v: 5.33 }
    ]);
  });
  it("respeta un orden fijo y completa con ceros", () => {
    expect(groupSum(rows, "k", ["v"], { order: ["A", "Z"] })).toEqual([
      { label: "A", v: 1 },
      { label: "Z", v: 0 }
    ]);
  });
});
