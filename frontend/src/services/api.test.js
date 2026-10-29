import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedFetch } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticatedFetch", () => {
  it("sends the Firebase ID token as a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const user = { getIdToken: vi.fn().mockResolvedValue("firebase-id-token") };

    await authenticatedFetch(user, "/api/lessons");

    expect(user.getIdToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/lessons",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer firebase-id-token",
        }),
      }),
    );
  });
});
