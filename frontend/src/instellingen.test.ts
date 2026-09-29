import { describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ APENKAAS_API: "http://ak/api/t", authFetch: (u: string, i?: RequestInit) => fetch(u, i) }));
const { laadInstellingen, STANDAARD } = await import("./instellingen");

describe("laadInstellingen", () => {
  it("maakt één document bij gelijktijdige aanroepen", async () => {
    let posts = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        return new Response(JSON.stringify({ id: "d1", data: STANDAARD }), { status: 200 });
      }
      return new Response(JSON.stringify({ documents: [], count: 0 }), { status: 200 });
    }));
    const [a, b] = await Promise.all([laadInstellingen(), laadInstellingen()]);
    expect(posts).toBe(1);
    expect(a.id).toBe("d1");
    expect(b.id).toBe("d1");
  });

  it("vult ontbrekende velden aan met standaardwaarden", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ documents: [{ id: "d2", data: { tarief_piek: 0.3 } }] }), { status: 200 })));
    const { data } = await laadInstellingen();
    expect(data.tarief_piek).toBe(0.3);
    expect(data.tarief_dal).toBe(STANDAARD.tarief_dal);
    expect(data.advies).toEqual({});
  });
});
