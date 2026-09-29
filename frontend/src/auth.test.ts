import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("window", { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} });

const { authFetch, getSessie } = await import("./auth");

function sessie(access: string) {
  store.set("energy-dash.sessie", JSON.stringify({ accessToken: access, refreshToken: "r1", userId: "u1", email: "a@b.nl" }));
}

describe("authFetch", () => {
  beforeEach(() => store.clear());

  it("ververst één keer bij gelijktijdige 401s", async () => {
    sessie("oud");
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/refresh")) {
        refreshes++;
        return new Response(JSON.stringify({ accessToken: "nieuw", refreshToken: "r2" }), { status: 200 });
      }
      const auth = new Headers(init?.headers).get("Authorization");
      return new Response("{}", { status: auth === "Bearer nieuw" ? 200 : 401 });
    }));
    const [a, b] = await Promise.all([authFetch("/api/now"), authFetch("/api/hours")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(refreshes).toBe(1);
    expect(getSessie()?.refreshToken).toBe("r2");
  });

  it("wist de sessie als refresh mislukt", async () => {
    sessie("oud");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    expect((await authFetch("/api/now")).status).toBe(401);
    expect(getSessie()).toBeNull();
  });
});
