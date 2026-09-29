import { describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ APENKAAS_API: "http://ak/api/t", authFetch: (u: string, i?: RequestInit) => fetch(u, i) }));
const { laadInstellingen, bewaarInstellingen, STANDAARD } = await import("./instellingen");

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

  it("bewaren schrijft alleen het eigen deel en overschrijft het andere niet", async () => {
    // "server" met één document; PATCH vervangt data (de test-server merget niet, dus
    // wat wij sturen moet al de actuele versie plus alleen ons deel zijn)
    let serverData: Record<string, unknown> = { ...STANDAARD, advies: { capacity: 10 } };
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        serverData = JSON.parse(init.body as string).data;
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify({ documents: [{ id: "d3", data: serverData }] }), { status: 200 });
    }));
    // Instellingen-pagina heeft een oude kopie zonder advies; Advies schrijft ondertussen
    await bewaarInstellingen("d3", { advies: { capacity: 14 } });
    await bewaarInstellingen("d3", { tarief_piek: 0.4, tarief_dal: 0.3, tarief_teruglevering: 0.05 });
    expect(serverData.advies).toEqual({ capacity: 14 });
    expect(serverData.tarief_piek).toBe(0.4);
    await bewaarInstellingen("d3", { advies: { capacity: 20 } });
    expect(serverData.tarief_piek).toBe(0.4);
    expect(serverData.advies).toEqual({ capacity: 20 });
  });
});
