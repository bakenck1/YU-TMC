import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "@/lib/domain/application-error";
import { hasPermission } from "@/lib/security/permissions";
import { createOneCReconciliationAdminHandlers, type OneCReconciliationAdminService } from "@/lib/server/http/one-c-reconciliation-admin-handler";

const ID="11111111-1111-4111-8111-111111111111";
const actor={userId:ID,role:"admin" as const};
function service(overrides:Partial<OneCReconciliationAdminService>={}):OneCReconciliationAdminService{return {
  listBatches:async(q)=>q,getBatch:async(id)=>({id}),listBatchRows:async(id,q)=>({id,...q}),getRowCandidates:async(id,externalId)=>({id,externalId}),exportBatch:async(id)=>({id,rows:[]}),analyzeBatch:async(id,input)=>({id,...input}),decideRow:async(id,externalId,input)=>({id,externalId,...input}),decideRowsBulk:async(id,input)=>({id,...input}),approveBatch:async(id,input)=>({id,...input}),publishBatch:async(id,input)=>({id,...input}),getPublication:async(id)=>({id}),...overrides,
};}
function handlers(overrides:Partial<OneCReconciliationAdminService>={}){return createOneCReconciliationAdminHandlers({authenticate:async()=>actor,service:()=>service(overrides)});}
function context(id=ID){return{params:Promise.resolve({id})};}

test("1C management permission belongs only to administrators",()=>{assert.equal(hasPermission("admin","inventory.integration.one_c.manage"),true);assert.equal(hasPermission("warehouse","inventory.integration.one_c.manage"),false);assert.equal(hasPermission("employee","inventory.integration.one_c.manage"),false);});
test("batch and row list queries enforce bounded server pagination",async()=>{const h=handlers();assert.equal((await h.listBatches(new Request("https://x.test/api?state=received&page=2&pageSize=100"))).status,200);assert.equal((await h.listBatches(new Request("https://x.test/api?pageSize=101"))).status,400);assert.equal((await h.listBatchRows(new Request("https://x.test/api?search=abc&pageSize=50"),context())).status,200);});
test("row candidates are scoped by validated batch and external identifiers",async()=>{const h=handlers();const ctx={params:Promise.resolve({id:ID,externalId:ID})};assert.equal((await h.getRowCandidates(new Request("https://x.test/api"),ctx)).status,200);});
test("candidate lookup forwards 1C GUID, 1C code and inventory number searches exactly",async()=>{
  const searches=[ID,"000009352","2416/1056"];
  const seen:string[]=[];
  const h=handlers({listBatchRows:async(_id,query)=>{seen.push(query.search??"");return{data:[],...query,total:0};}});
  for(const search of searches){
    const response=await h.listBatchRows(new Request(`https://x.test/api?search=${encodeURIComponent(search)}`),context());
    assert.equal(response.status,200);
  }
  assert.deepEqual(seen,searches);
});
test("manual link decision preserves the explicitly selected Inventory item",async()=>{
  const selectedItemId="22222222-2222-4222-8222-222222222222";
  let received:unknown;
  const h=handlers({decideRow:async(id,externalId,input,receivedActor)=>{
    received={id,externalId,input,actor:receivedActor};
    return{matchedItemId:selectedItemId};
  }});
  const response=await h.decideRow(new Request("https://x.test/api",{
    method:"PATCH",headers:{"content-type":"application/json"},
    body:JSON.stringify({version:3,decision:{confirmLink:true,itemId:selectedItemId,expectedItemVersion:5}}),
  }),{params:Promise.resolve({id:ID,externalId:ID})});
  assert.equal(response.status,200);
  assert.deepEqual(received,{
    id:ID,externalId:ID,
    input:{version:3,decision:{confirmLink:true,itemId:selectedItemId,expectedItemVersion:5}},
    actor,
  });
});
test("manual link decisions require an item version and reject client-supplied match reasons",async()=>{
  const h=handlers();
  const patch=(decision:Record<string,unknown>)=>h.decideRow(new Request("https://x.test/api",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({version:1,decision})}),{params:Promise.resolve({id:ID,externalId:ID})});
  assert.equal((await patch({confirmLink:true,itemId:ID})).status,400);
  assert.equal((await patch({confirmLink:true,itemId:ID,expectedItemVersion:1,matchedBy:["guid"]})).status,400);
});
test("mutations require optimistic versions, plan hashes and idempotency keys",async()=>{const h=handlers();const post=(body:unknown,headers:Record<string,string>={})=>new Request("https://x.test/api",{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});assert.equal((await h.approveBatch(post({version:1}),context())).status,400);assert.equal((await h.publishBatch(post({version:1,planHash:"a".repeat(64)}),context())).status,400);assert.equal((await h.publishBatch(post({version:1,planHash:"a".repeat(64)},{"idempotency-key":"publish-123"}),context())).status,202);});
test("authentication failures are returned without invoking the service",async()=>{const h=createOneCReconciliationAdminHandlers({authenticate:async()=>{throw new ApplicationError("forbidden","forbidden");},service:()=>{throw new Error("must_not_run");}});assert.equal((await h.getBatch(new Request("https://x.test"),context())).status,403);});
