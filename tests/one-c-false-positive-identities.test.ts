import assert from 'node:assert/strict';
import test from 'node:test';
import {buildInventorySourceAudit, type AuditItem, type AuditMatch, type ExcelSourceRow} from '../lib/inventory-source-audit';
import {classifyOneCAudit,summarizeOneCAudit} from '../lib/one-c-analytics';
import {extractSourceBarcodeNumbers,inventoryAuditItemNameNumbers} from '../lib/inventory-audit-numbers';
import {buildInventoryAuditEnrichmentPlan} from '../lib/inventory-audit-enrichment';
import {addOneCPriceProposals} from '../lib/one-c-enrichment-price';
import type {OneCFixedAsset} from '../lib/contracts/one-c-fixed-assets';
const options={descriptionBarcodes:true,formattedNumbers:true,exactNames:true,allowDescriptionIdentity:true,includeIt:true,allowSourceCode:true};
const card:AuditItem & {itemSection:string;unitPrice:string;status:string}={id:'fb93acf0-1d5f-49e4-afd6-c7e8be026354',name:'Стол',inventoryNumber:'TMP-2026-146DA4E0E63108AFC77B',inventoryNumberKind:'temporary',oneCCode:null,officialBarcodes:['TMP-2026-146DA4E0E63108AFC77B'],sourceCodes:[],version:1,itemSection:'general',unitPrice:'0',status:'active'};
const os:OneCFixedAsset={externalId:'os',code:'000004741',name:'Стол',inventoryNumber:null,barcode:null,status:'Не в учёте',quantity:1,residualCost:0,initialCost:5000,category:null,location:null,responsibleName:null,responsibleExternalId:null,acceptedAt:null,updatedAt:null};
const mp:ExcelSourceRow={sourceKind:'materials_api',sourceKey:'mp',rowNumber:1,oneCCode:'000004741',nomenclature:'Стол',inventoryNumber:'',explicitInventoryNumber:null,barcode:null,endingBalance:'1',unitPrice:'5000'};
function review(item=card,assets:OneCFixedAsset[]=[os],materials:ExcelSourceRow[]=[]){const audit=buildInventorySourceAudit([item],assets.map(asset=>({externalId:asset.externalId,asset})),materials,[],options);const plan=buildInventoryAuditEnrichmentPlan(audit.rows,[item],options);addOneCPriceProposals(plan,audit.rows,new Map(assets.map(asset=>[asset.externalId,asset])),[item],{independentSources:true});return {audit,plan,presence:classifyOneCAudit(audit.rows).get(item.id)!};}
for(const registry of ['os','mp'] as const) for(const name of ['Стол','Монитор','Системный блок','Unique printer']) test(`${registry}: an identical name cannot confirm an anonymous temporary card: ${name}`,()=>{
 const {audit,plan,presence}=review({...card,name},registry==='os'?[{...os,name}]:[],registry==='mp'?[{...mp,nomenclature:name}]:[]);
 assert.equal(presence.category,'missing');assert.equal(plan.rows[0].eligible,false);assert.equal(plan.rows[0].price?.changed,false);assert.equal(plan.rows[0].nextCode,null);
 assert.equal(summarizeOneCAudit(audit.rows,[],[]).temporaryUnmatched,1);
});
test('89 tables cannot all be matched to the unique source table by its common name',()=>{
 const items=Array.from({length:89},(_,i)=>({...card,id:`table-${i}`,inventoryNumber:`TMP-2026-${i}`}));const audit=buildInventorySourceAudit(items,[{externalId:os.externalId,asset:os}],[],[],options);const summary=summarizeOneCAudit(audit.rows,[],[]);assert.equal(summary.temporaryUnmatched,89);assert.equal(summary.temporaryFound,0);
});
for(const name of ['шкаф 800*400*2000','стол 1400*700*750','тумба 400*450*550','стол 1600*800*750','шкаф 800 *400* 2000','ABC*12345*DEF']) test(`dimension/model fragments are not barcodes: ${name}`,()=>{
 assert.deepEqual(extractSourceBarcodeNumbers(name),[]);assert.deepEqual(inventoryAuditItemNameNumbers(name),[]);
 const {presence,plan}=review({...card,name},[{...os,name}], [{...mp,nomenclature:name}]);assert.equal(presence.category,'missing');assert.equal(plan.rows[0].price?.changed,false);
});
test('a standalone complete Code 39 token still confirms by barcode',()=>{
 assert.deepEqual(extractSourceBarcodeNumbers('Стол *YUB-1350/14444*'),['1350/14444']);
 const {presence,plan}=review({...card,name:'Стол *1350/14444*'},[{...os,inventoryNumber:'135014444',name:'Стол №1350/14444'}]);assert.equal(presence.fixedAssets,true);assert.equal(plan.rows[0].nextCode,os.code);assert.equal(plan.rows[0].price?.nextUnitPrice,'5000.00');
});
for(const registry of ['os','mp'] as const) test(`${registry}: exact saved code still confirms a temporary card`,()=>{
 const {presence,plan}=review({...card,oneCCode:os.code},registry==='os'?[os]:[],registry==='mp'?[mp]:[]);assert.equal(presence.category,registry==='os'?'fixedAssets':'materials');assert.equal(plan.rows[0].price?.nextUnitPrice,'5000.00');
});
for(const registry of ['os','mp'] as const) test(`${registry}: a complete inventory number after punctuation in the name still confirms`,()=>{
 const item={...card,name:'стол прист.д/перег.No125/00134 02.04.10 канцелярия'};
 const sourceName='стол прист.д/перег. №125/00134 02.04.10 канцелярия';
 const {presence,plan}=review(item,registry==='os'?[{...os,name:sourceName,inventoryNumber:'12500134'}]:[],registry==='mp'?[{...mp,nomenclature:sourceName}]:[]);
 assert.equal(presence.category,registry==='os'?'fixedAssets':'materials');assert.equal(plan.rows[0].nextCode,os.code);assert.equal(plan.rows[0].price?.nextUnitPrice,'5000.00');
});
test('saved exact-name evidence cannot bypass identifier verification or resurrect a price',()=>{
 const source:AuditMatch['oneC'][number]={externalId:os.externalId,name:os.name,code:os.code,inventoryNumber:null,barcode:null,status:'Не в учёте',origins:['current_registry'],matchedBy:['exact_name'],matchedBarcodes:[]};
 for(const registry of ['os','mp']){const row:AuditMatch={itemId:card.id,itemName:card.name,siteNumber:card.inventoryNumber,siteOneCCode:null,numberKind:'temporary',itemVersion:1,siteBarcodes:[],result:'matched',source:registry==='os'?'1c':'excel',oneC:registry==='os'?[source]:[],excel:registry==='mp'?[{...mp,matchedBy:['exact_name']}]:[]};assert.equal(classifyOneCAudit([row]).get(card.id)?.category,'possible');const plan=buildInventoryAuditEnrichmentPlan([row],[{...card,officialBarcodes:[]}],options);addOneCPriceProposals(plan,[row],new Map([[os.externalId,os]]),[{...card,officialBarcodes:[]}],{independentSources:true});assert.equal(plan.rows[0].eligible,false);assert.equal(plan.rows[0].price?.changed,false);}
});
