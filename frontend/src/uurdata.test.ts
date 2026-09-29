import { describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ APENKAAS_API: "http://ak/api/t", authFetch: (u: string, i?: RequestInit) => fetch(u, i) }));
const { bewaarCsv } = await import("./uurdata");

function server(uploadStatus: number) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const m = init?.method ?? "GET";
    calls.push(`${m} ${u}`);
    if (u === "http://minio/up") return new Response(null, { status: uploadStatus });
    if (m === "DELETE") return new Response("", { status: 200 });
    if (m === "POST") return new Response(JSON.stringify({ id: "nieuw", uploadUrl: "http://minio/up", fields: {} }), { status: 200 });
    return new Response(JSON.stringify([{ id: "oud", aangemaakt_op: "2020" }]), { status: 200 });
  }));
  return calls;
}
const dels = (calls: string[]) => calls.filter((c) => c.startsWith("DELETE"));

describe("bewaarCsv", () => {
  it("verwijdert oude bestanden pas na een geslaagde upload", async () => {
    const calls = server(204);
    await bewaarCsv("a,b");
    expect(dels(calls)).toEqual(["DELETE http://ak/api/t/storage/files/oud"]);
    expect(calls.indexOf("POST http://minio/up")).toBeLessThan(calls.indexOf(dels(calls)[0]));
  });

  it("bij mislukte upload: nieuwe lege record weg, oude blijft", async () => {
    const calls = server(500);
    await expect(bewaarCsv("a,b")).rejects.toThrow();
    expect(dels(calls)).toEqual(["DELETE http://ak/api/t/storage/files/nieuw"]);
  });

  it("wissen (null) verwijdert alles", async () => {
    const calls = server(204);
    await bewaarCsv(null);
    expect(dels(calls)).toEqual(["DELETE http://ak/api/t/storage/files/oud"]);
  });
});
