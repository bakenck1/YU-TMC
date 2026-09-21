import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "@/lib/domain/application-error";
import { hasPermission } from "@/lib/security/permissions";
import { createOneCReconciliationAdminHandlers, type OneCReconciliationAdminService } from "@/lib/server/http/one-c-reconciliation-admin-handler";

const ID="11111111-1111-4111-8111-111111111111";
const actor={userId:ID,role:"admin" as const};
function service(overrides:Partial<OneCReconciliationAdminService>={}):OneCReconciliationAdminService{return {
  listBatches:async(q)=>q,getBatch:async(id)=>({id}),listBatchRows:async(id,q)=>({id,...q}),analyzeBatch:async(id,input)=>({id,...input}),decideRow:async(id,externalId,input)=>({id,externalId,...input}),decideRowsBulk:async(id,input)=>({id,...input}),approveBatch:async(id,input)=>({id,...input}),publishBatch:async(id,input)=>({id,...input}),getPublication:async(id)=>({id}),...overrides,
};}
function handlers(overrides:Partial<OneCReconciliationAdminService>={}){return createOneCReconciliationAdminHandlers({authenticate:async()=>actor,service:()=>service(overrides)});}
function context(id=ID){return{params:Promise.resolve({id})};}

test("1C management permission belongs only to administrators",()=>{assert.equal(hasPermission("admin","inventory.integration.one_c.manage"),true);assert.equal(hasPermission("warehouse","inventory.integration.one_c.manage"),false);assert.equal(hasPermission("employee","inventory.integration.one_c.manage"),false);});
test("batch and row list queries enforce bounded server pagination",async()=>{const h=handlers();assert.equal((await h.listBatches(new Request("https://x.test/api?state=received&page=2&pageSize=100"))).status,200);assert.equal((await h.listBatches(new Request("https://x.test/api?pageSize=101"))).status,400);assert.equal((await h.listBatchRows(new Request("https://x.test/api?search=abc&pageSize=50"),context())).status,200);});
test("mutations require optimistic versions, plan hashes and idempotency keys",async()=>{const h=handlers();const post=(body:unknown,headers:Record<string,string>={})=>new Request("https://x.test/api",{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});assert.equal((await h.approveBatch(post({version:1}),context())).status,400);assert.equal((await h.publishBatch(post({version:1,planHash:"a".repeat(64)}),context())).status,400);assert.equal((await h.publishBatch(post({version:1,planHash:"a".repeat(64)},{"idempotency-key":"publish-123"}),context())).status,202);});
test("authentication failures are returned without invoking the service",async()=>{const h=createOneCReconciliationAdminHandlers({authenticate:async()=>{throw new ApplicationError("forbidden","forbidden");},service:()=>{throw new Error("must_not_run");}});assert.equal((await h.getBatch(new Request("https://x.test"),context())).status,403);});
