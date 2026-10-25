import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/mocks/server";
import { createTelegramLink, getChatIdentities, unlinkChatIdentity } from "./chatIdentities";

describe("chat identities API", () => {
  it("lists links, makes a Telegram link and unlinks", async () => {
    const hits: string[] = [];
    server.use(
      http.get("/api/chat-identities", () => HttpResponse.json({ success: true, data: { identities: [{ id: "i1", platform: "telegram", externalId: "42", displayName: "@ana", createdAt: 1 }], telegramBots: ["chouse_bot"], email: "ana@x.io" } })),
      http.post("/api/chat-identities/telegram/link-code", async ({ request }) => {
        hits.push(JSON.stringify(await request.json()));
        return HttpResponse.json({ success: true, data: { link: "https://t.me/chouse_bot?start=abc", expiresAt: 5 } });
      }),
      http.delete("/api/chat-identities/i1", () => {
        hits.push("delete");
        return HttpResponse.json({ success: true });
      }),
    );
    const data = await getChatIdentities();
    expect(data.identities[0].displayName).toBe("@ana");
    expect(data.telegramBots).toEqual(["chouse_bot"]);
    expect((await createTelegramLink("chouse_bot")).link).toBe("https://t.me/chouse_bot?start=abc");
    await unlinkChatIdentity("i1");
    expect(hits).toEqual(['{"bot":"chouse_bot"}', "delete"]);
  });
});
