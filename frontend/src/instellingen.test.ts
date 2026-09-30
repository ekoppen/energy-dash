import { describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({
  APENKAAS_API: "http://ak/api/t",
  authFetch: (u: string, i?: RequestInit) => fetch(u, i),
  getSessie: () => ({ userId: "u1" }),
}));
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
      new Response(JSON.stringify({ documents: [{ id: "d2", data: { tarief_piek: 0.3 }, read_permissions: ["user:u1", "app"], write_permissions: ["user:u1"] }] }), { status: 200 })));
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
      return new Response(JSON.stringify({ documents: [{ id: "d3", data: serverData, read_permissions: ["user:u1", "app"], write_permissions: ["user:u1"] }] }), { status: 200 });
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

describe("leesrecht voor de server", () => {
  it("maakt een nieuw document aan met app-leesrecht", async () => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === "POST") { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ id: "n1" }), { status: 200 }); }
      return new Response(JSON.stringify({ documents: [] }), { status: 200 });
    }));
    await laadInstellingen();
    expect(body.readPermissions).toEqual(["user:u1", "app"]);
    expect(body.writePermissions).toEqual(["user:u1"]);
    expect(body.data.virtuele_accu).toEqual(STANDAARD.virtuele_accu);
  });

  it("zet een bestaand document zonder app-leesrecht om: nieuw aanmaken, oud verwijderen", async () => {
    const calls: string[] = [];
    let nieuwBody: any;
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (init?.method === "POST") { nieuwBody = JSON.parse(init.body as string); return new Response(JSON.stringify({ id: "n2" }), { status: 200 }); }
      if (init?.method === "DELETE") return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ documents: [
        { id: "oud", data: { tarief_piek: 0.3 }, read_permissions: ["user:u1"], write_permissions: ["user:u1"] },
      ] }), { status: 200 });
    }));
    const { id, data } = await laadInstellingen();
    expect(id).toBe("n2");
    expect(data.tarief_piek).toBe(0.3);
    expect(nieuwBody.data.tarief_piek).toBe(0.3);
    expect(calls.some((c) => c.startsWith("DELETE") && c.endsWith("/oud"))).toBe(true);
  });

  it("na een half gelukte omzetting: kiest het document mét app-leesrecht en ruimt het andere op", async () => {
    let posts = 0;
    const verwijderd: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts++; return new Response("{}", { status: 200 }); }
      if (init?.method === "DELETE") { verwijderd.push(u.split("/").pop()!); return new Response("{}", { status: 200 }); }
      return new Response(JSON.stringify({ documents: [
        { id: "oud", data: { tarief_piek: 0.3 }, read_permissions: ["user:u1"], write_permissions: ["user:u1"] },
        { id: "nieuw", data: { tarief_piek: 0.3 }, read_permissions: ["user:u1", "app"], write_permissions: ["user:u1"] },
      ] }), { status: 200 });
    }));
    const { id } = await laadInstellingen();
    expect(id).toBe("nieuw");
    expect(posts).toBe(0);
    expect(verwijderd).toEqual(["oud"]);
  });

  const VREEMD = { id: "vreemd", data: { tarief_piek: 9 }, read_permissions: ["any", "app"], write_permissions: ["user:aanvaller"] };

  it("negeert een vreemd leesbaar document: eigen document mét app wordt gekozen, vreemd niet verwijderd", async () => {
    const verwijderd: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      if (init?.method === "DELETE") { verwijderd.push(u.split("/").pop()!); return new Response("{}", { status: 200 }); }
      return new Response(JSON.stringify({ documents: [
        VREEMD,
        { id: "eigen", data: { tarief_piek: 0.3 }, read_permissions: ["user:u1", "app"], write_permissions: ["user:u1"] },
      ] }), { status: 200 });
    }));
    const { id, data } = await laadInstellingen();
    expect(id).toBe("eigen");
    expect(data.tarief_piek).toBe(0.3);
    expect(verwijderd).not.toContain("vreemd");
  });

  it("negeert een vreemd document bij omzetten: kopieert de eigen data, verwijdert alleen het eigen oude document", async () => {
    const verwijderd: string[] = [];
    let nieuwBody: any;
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      if (init?.method === "POST") { nieuwBody = JSON.parse(init.body as string); return new Response(JSON.stringify({ id: "n3" }), { status: 200 }); }
      if (init?.method === "DELETE") { verwijderd.push(u.split("/").pop()!); return new Response("{}", { status: 200 }); }
      return new Response(JSON.stringify({ documents: [
        VREEMD,
        { id: "eigenoud", data: { tarief_piek: 0.3 }, read_permissions: ["user:u1"], write_permissions: ["user:u1"] },
      ] }), { status: 200 });
    }));
    const { id } = await laadInstellingen();
    expect(id).toBe("n3");
    expect(nieuwBody.data.tarief_piek).toBe(0.3);
    expect(verwijderd).toEqual(["eigenoud"]);
  });
});
