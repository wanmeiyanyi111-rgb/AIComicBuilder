import test from "node:test";
import assert from "node:assert/strict";
import { GET as getProjectByIdRoute } from "../../src/app/api/projects/[id]/route";
import { POST as generateRoute } from "../../src/app/api/projects/[id]/generate/route";
import {
  GET as listProjectsRoute,
  POST as createProjectRoute,
} from "../../src/app/api/projects/route";

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

test("project detail route returns 404 when request has no identity", async () => {
  const request = new Request("http://localhost/api/projects/proj-1", {
    method: "GET",
  });

  const response = await getProjectByIdRoute(request, makeParams("proj-1"));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
});

test("generate route rejects mismatched cookie/header identity", async () => {
  const request = new Request("http://localhost/api/projects/proj-1/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "ai_comic_uid=cookie-user-1",
      "x-user-id": "forged-user-1",
    },
    body: JSON.stringify({
      action: "script_outline",
      payload: { idea: "test" },
    }),
  });

  const response = await generateRoute(request, makeParams("proj-1"));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
});

test("projects list route rejects request without identity", async () => {
  const request = new Request("http://localhost/api/projects", {
    method: "GET",
  });

  const response = await listProjectsRoute(request);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("projects create route rejects mismatched cookie/header identity", async () => {
  const request = new Request("http://localhost/api/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "ai_comic_uid=cookie-user-1",
      "x-user-id": "forged-user-1",
    },
    body: JSON.stringify({
      title: "test",
    }),
  });

  const response = await createProjectRoute(request);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});
