import test from "node:test";
import assert from "node:assert/strict";
import { getUserIdFromRequest } from "../../src/lib/get-user-id";

function makeRequest(headers: HeadersInit): Request {
  return new Request("http://localhost/test", { headers });
}

test("uses cookie user id when present", () => {
  const request = makeRequest({ cookie: "ai_comic_uid=cookie-user-1" });
  assert.equal(getUserIdFromRequest(request), "cookie-user-1");
});

test("falls back to x-user-id header for legacy requests", () => {
  const request = makeRequest({ "x-user-id": "legacy-user-1" });
  assert.equal(getUserIdFromRequest(request), "legacy-user-1");
});

test("rejects mismatched cookie/header pair", () => {
  const request = makeRequest({
    cookie: "ai_comic_uid=cookie-user-1",
    "x-user-id": "forged-user-1",
  });
  assert.equal(getUserIdFromRequest(request), "");
});

test("accepts matching cookie/header pair", () => {
  const request = makeRequest({
    cookie: "ai_comic_uid=same-user",
    "x-user-id": "same-user",
  });
  assert.equal(getUserIdFromRequest(request), "same-user");
});

