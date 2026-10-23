import { describe, expect, test } from "bun:test";
import {
  checkImageUrl,
  fetchImage,
  FetchImageError,
  isPrivateAddress,
  MAX_IMAGE_BYTES,
  pinnedRequest,
} from "./fetch-image";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const publicLookup = async () => ["93.184.216.34"];

/** A fake web: maps URLs (the name from the Host header) to responses, and records what was asked. */
const web = (routes: Record<string, () => Response>) => {
  const asked: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const sent = new URL(String(input));
    const host = (init?.headers as Record<string, string> | undefined)?.Host;
    if (host) sent.host = host;
    const url = sent.toString();
    asked.push(url);
    const route = routes[url];
    return route ? route() : new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;
  return { asked, impl };
};

const image = (
  type = "image/png",
  body: ConstructorParameters<typeof Response>[0] = PNG,
  headers: Record<string, string> = {},
) => new Response(body, { headers: { "content-type": type, ...headers } });

const rejects = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(FetchImageError);
  expect((error as FetchImageError).status).toBe(status);
};

describe("fetch-image", () => {
  test("private, loopback, link-local and reserved addresses are refused", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:192.168.0.1",
      "not-an-ip",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "172.32.0.1"]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  test("IPv6 forms that carry a private IPv4 address, and reserved IPv6 ranges, are refused", () => {
    // How URL normalizes https://[::ffff:127.0.0.1]/ (hex, not dotted).
    const fromUrl = new URL("https://[::ffff:127.0.0.1]/x.png").hostname.replace(/^\[|\]$/g, "");
    for (const address of [
      fromUrl,
      "::ffff:7f00:1",
      "::ffff:a00:1",
      "0:0:0:0:0:ffff:c0a8:1",
      "::127.0.0.1",
      "::",
      "0:0:0:0:0:0:0:1",
      "64:ff9b::a9fe:a9fe", // NAT64 of 169.254.169.254
      "64:ff9b:1::1",
      "2002:7f00:1::", // 6to4 of 127.0.0.1
      "2001:0:4136:e378::1", // Teredo
      "2001:db8::1",
      "100::1",
      "fec0::1",
      "febf::1",
      "fc00::1",
      "ff02::1",
      "fe80::1%en0",
      "1:2:3:4:5:6:7:8:9",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of [
      "::ffff:808:808", // 8.8.8.8
      "64:ff9b::808:808",
      "2002:808:808::1",
      "2a00:1450:4001:82a::200e",
    ]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  test("only https on the default port, no credentials", () => {
    expect(checkImageUrl("https://example.com/a.png").hostname).toBe("example.com");
    for (const bad of [
      "http://example.com/a.png",
      "https://example.com:8443/a.png",
      "https://user:pw@example.com/a.png",
      "file:///etc/passwd",
      "nope",
    ]) {
      expect(() => checkImageUrl(bad)).toThrow(FetchImageError);
    }
  });

  test("returns the image's bytes and type", async () => {
    const { impl } = web({ "https://example.com/a.png": () => image() });
    const result = await fetchImage("https://example.com/a.png", {
      lookup: publicLookup,
      fetch: impl,
    });
    expect(result).toEqual({ bytes: PNG, type: "image/png" });
  });

  test("the request goes to the checked address, TLS and Host keep the name (DNS rebinding)", async () => {
    const calls: { url: string; init?: BunFetchRequestInit }[] = [];
    const impl = (async (input: string | URL | Request, init?: BunFetchRequestInit) => {
      calls.push({ url: String(input), init });
      return image();
    }) as unknown as typeof fetch;
    await fetchImage("https://example.com/a.png?x=1", { lookup: publicLookup, fetch: impl });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe("https://93.184.216.34/a.png?x=1");
    expect((call!.init?.headers as Record<string, string>).Host).toBe("example.com");
    expect(call!.init?.tls).toEqual({ serverName: "example.com" });
    expect(call!.init?.proxy).toBe(false);

    const v6 = pinnedRequest(new URL("https://example.com/a.png"), "2606:4700:4700::1111");
    expect(v6.url.toString()).toBe("https://[2606:4700:4700::1111]/a.png");
    // A literal IP has no name to check the certificate against.
    expect(pinnedRequest(new URL("https://93.184.216.34/a.png"), "93.184.216.34").init.tls).toBe(
      undefined,
    );
  });

  test("a host that resolves to a private address is refused before any request", async () => {
    const { asked, impl } = web({ "https://intranet.test/a.png": () => image() });
    await rejects(
      fetchImage("https://intranet.test/a.png", { lookup: async () => ["10.0.0.5"], fetch: impl }),
      403,
    );
    await rejects(fetchImage("https://127.0.0.1/a.png", { fetch: impl }), 403);
    expect(asked).toEqual([]);
  });

  test("redirects are followed (at most 3) and each target is checked again", async () => {
    const redirect = (to: string) => () =>
      new Response(null, { status: 302, headers: { location: to } });
    const ok = web({
      "https://a.test/img": redirect("https://cdn.test/img.webp"),
      "https://cdn.test/img.webp": () => image("image/webp"),
    });
    expect(
      (await fetchImage("https://a.test/img", { lookup: publicLookup, fetch: ok.impl })).type,
    ).toBe("image/webp");

    const toPrivate = web({ "https://a.test/img": redirect("https://internal.test/x.png") });
    await rejects(
      fetchImage("https://a.test/img", {
        lookup: async (host) => (host === "internal.test" ? ["192.168.0.2"] : ["93.184.216.34"]),
        fetch: toPrivate.impl,
      }),
      403,
    );
    const toHttp = web({ "https://a.test/img": redirect("http://a.test/img.png") });
    await rejects(
      fetchImage("https://a.test/img", { lookup: publicLookup, fetch: toHttp.impl }),
      400,
    );

    const loop = web({ "https://a.test/img": redirect("https://a.test/img") });
    await rejects(
      fetchImage("https://a.test/img", { lookup: publicLookup, fetch: loop.impl }),
      502,
    );
  });

  test("only images, at most 10 MB", async () => {
    const page = web({ "https://example.com/": () => image("text/html", "<html>") });
    await rejects(
      fetchImage("https://example.com/", { lookup: publicLookup, fetch: page.impl }),
      415,
    );
    const svg = web({ "https://example.com/a.svg": () => image("image/svg+xml", "<svg/>") });
    await rejects(
      fetchImage("https://example.com/a.svg", { lookup: publicLookup, fetch: svg.impl }),
      415,
    );
    const huge = web({
      "https://example.com/big.png": () => image("image/png", new Uint8Array(MAX_IMAGE_BYTES + 1)),
    });
    await rejects(
      fetchImage("https://example.com/big.png", { lookup: publicLookup, fetch: huge.impl }),
      413,
    );
  });
});
