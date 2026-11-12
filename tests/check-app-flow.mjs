import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=await readFile(root+'/dist/app.js','utf8');
const guestSource=source.slice(source.indexOf('async function loadGuest('),source.indexOf('\nasync function persistLocal'));
const activateSource=source.slice(source.indexOf('async function activateUser('),source.indexOf('\nasync function resizeImage'));
const scanSource=source.slice(source.indexOf('async function generateScanReport('),source.indexOf('\nfunction profileView'));
function guestContext(hash, record=null){
 const values=new Map([['ecoplant-guest-id','local-existing'],['ecoplant-access-mode','local']]);
 const state={user:null,guest:false,profile:{},plants:[],analyses:[]};
 const context={state,location:{hash},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))},uuid:()=> 'new-id',unsubscribeData(){},modelLoadController:null,scanLoadController:null,clearImportedPlantModel(){},lastRenderedRoute:'',blankData:()=>({profile:{},plants:[],analyses:[]}),getCachedData:async uid=>({profile:{displayName:'Local'},plants:[{id:'local-plant'}],analyses:[]}),rememberAccessMode:mode=>values.set('ecoplant-access-mode',mode),restoreDraft:()=>{if(record)state.draft=record;},go(hash){context.location.hash=hash;},render(){},finishSplash(){},accessMode:()=>values.get('ecoplant-access-mode'),toast(){},errorMessage:e=>e.message,authResolved:false,console};
 vm.createContext(context);vm.runInContext(guestSource+'\n'+activateSource,context);return context;
}
for(const hash of ['#scan','#scan?plant=local-plant','#plant/local-plant','#history','#profile?model=files']){
 const c=guestContext(hash);await c.loadGuest({destination:hash});assert.equal(c.location.hash,hash);assert.equal(c.state.user.uid,'local-existing');assert.equal(c.state.guest,true);
}
{
 const c=guestContext('#report/draft');await c.loadGuest({destination:'#report/draft'});assert.equal(c.location.hash,'#scan');
 const d=guestContext('#report/draft',{id:'draft-1'});await d.loadGuest({destination:'#report/draft'});assert.equal(d.location.hash,'#report/draft');
}
{
 const c=guestContext('#scan');let done;
 c.getCachedData=()=>new Promise(resolve=>{done=resolve;});
 c.cloud={ready:Promise.resolve({ok:true}),subscribeAuth(cb){void cb({uid:'firebase-account',displayName:'Cloud'});}};
 const boot=source.slice(source.lastIndexOf('render();\n// A chosen local garden'));
 vm.runInContext(boot,c);
 assert.equal(c.state.guest,true);assert.equal(c.state.user.uid,'local-existing');
 done({profile:{displayName:'Local'},plants:[],analyses:[]});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(c.state.user.uid,'local-existing');assert.equal(c.location.hash,'#scan');
}
{
 const c=guestContext('#scan');let done;c.getCachedData=()=>new Promise(resolve=>{done=resolve;});
 const promise=c.loadGuest({destination:'#scan'});c.state.guest=false;c.state.user={uid:'other-account'};
 done({profile:{displayName:'Should not leak'},plants:[],analyses:[]});await promise;
 assert.notEqual(c.state.profile.displayName,'Should not leak');
}
console.log('PASS local deep links, draft restoration, Firebase isolation, stale load discarded');
// Exercise the real routing/interpretation functions with explicit inference mocks.
// These assertions verify source selection, never trained-model accuracy.
const methodSource=source.slice(source.indexOf('function customModelURL('),source.indexOf('function activeModelSource('));
const clickSource=source.slice(source.indexOf("document.addEventListener('click',async e=>{"),source.indexOf("document.addEventListener('submit',async e=>{"));
const bundledURL='https://example.test/ecoplant/my_model/';
const bundledLabels=['Antracnose','Desconhecidas','Ferrugem','Fumagina','Míldio','Oídio','Plantas_Saudaveis','Podridão_radicular','Vitiligo','Planta de plastico'];
function modelContext(initial={}){
 const c={state:{profile:{},model:null,scanMethod:'',scanModelURL:null,scanPhoto:'data:image/jpeg;base64,AA==',...initial},
  MODEL_CONFIG:{bundledModelAvailable:true,bundledHealthyClass:'Plantas_Saudaveis',bundledNeutralClasses:['Desconhecidas','Planta de plastico'],bundledLabels},
  BUNDLED_MODEL_URL:'./my_model/',IMPORTED_MODEL_URL:'local:ecoplant-model',
  validateModelURL:url=>url==='./my_model/'?bundledURL:url,photoSafe:v=>v,findPlant:()=>null,SYMPTOMS:[],scanFailure:m=>new Error(m),uuid:()=> 'analysis-1',
  Image:class {set src(value){queueMicrotask(()=>this.onload());}},console};
 vm.createContext(c);vm.runInContext(methodSource+'\n'+scanSource,c);return c;
}
const scanData=method=>({get:k=>({plantId:'',notes:'Folha do aluno',method})[k],getAll:()=>[]});
{
 const c=modelContext({model:{source:'files',healthyClass:'Saudável'},profile:{healthyClass:'Outra classe'}});
 const output={method:'teachable-machine',modelURL:'local:ecoplant-model',modelLabels:['Saudável','Mancha'],topClass:'Saudável',confidence:.96,predictions:[{className:'Saudável',probability:.96},{className:'Mancha',probability:.04}]};
 let resolvePrediction,started;const ready=new Promise(resolve=>{started=resolve;});
 c.classifyPlant=async()=>{started();return new Promise(resolve=>{resolvePrediction=resolve;});};
 const pending=c.generateScanReport(scanData('teachable-machine'),()=>{},new AbortController().signal);
 await ready;c.state.model.healthyClass='Mancha';resolvePrediction(output);
 const record=await pending;
 assert.equal(record.result.title,'Classe saudável no modelo');assert.match(record.result.summary,/classe saudável selecionada/);assert.equal('healthyClass' in record.result,false);
 assert.equal(record.notes,'Folha do aluno');assert.equal(record.photo,c.state.scanPhoto);
}
console.log('PASS TM healthy-class snapshot survives later configuration changes without new Firebase fields');
for(const topClass of ['Plantas_Saudaveis','Desconhecidas','Planta de plastico','Ferrugem']){
 const c=modelContext({profile:{modelURL:'https://teachablemachine.withgoogle.com/models/own/',healthyClass:'Ferrugem'}});
 let seenURL;
 c.classifyPlant=async(image,url)=>{seenURL=url;return {method:'teachable-machine',modelURL:bundledURL,modelLabels:[...bundledLabels],topClass,confidence:.96,predictions:[{className:topClass,probability:.96}]};};
 const {result}=await c.generateScanReport(scanData('ecoplant'),()=>{},new AbortController().signal);
 assert.equal(seenURL,'./my_model/');assert.equal(result.method,'teachable-machine');assert.equal(result.topClass,topClass);
 assert.equal(result.title,topClass==='Plantas_Saudaveis'?'Classe saudável no modelo':['Desconhecidas','Planta de plastico'].includes(topClass)?'Classe fora da avaliação de saúde':'Classe identificada pelo modelo');
 if(['Desconhecidas','Planta de plastico'].includes(topClass)){assert.match(result.summary,/não recebe avaliação de saúde/);assert.notEqual(result.title,'Análise inconclusiva');}
 assert.equal('healthyClass' in result,false);assert.equal('neutralClasses' in result,false);
}
{
 const c=modelContext({model:{source:'files',healthyClass:'Plantas_Saudaveis'}});
 c.classifyPlant=async()=>({method:'teachable-machine',modelURL:'local:ecoplant-model',modelLabels:bundledLabels,topClass:'Desconhecidas',confidence:.96});
 assert.equal((await c.generateScanReport(scanData('teachable-machine'),()=>{},new AbortController().signal)).result.title,'Classe identificada pelo modelo','Bundled policy must not reinterpret a custom model.');
 c.classifyPlant=async()=>({method:'teachable-machine',modelURL:bundledURL,modelLabels:bundledLabels,topClass:'Desconhecidas',confidence:.6,severity:'observe',title:'Análise inconclusiva'});
 assert.equal((await c.generateScanReport(scanData('ecoplant'),()=>{},new AbortController().signal)).result.title,'Análise inconclusiva');
}
console.log('PASS bundled healthy/neutral policy is independent of profile, retains class/confidence, and respects low confidence');

// Fresh sessions default to EcoPlant; an explicit choice remains a choice.
for(const preferred of ['ecoplant','teachable-machine','plant-ai','guided','']){
 const c=modelContext({scanMethod:preferred,model:{source:'files',healthyClass:'Saudável'}});
 c.findPlant=()=>({id:'leaf',photo:'data:image/jpeg;base64,AA=='});
 c.document={addEventListener:(event,fn)=>{c.click=fn;}};c.go=hash=>{c.route=hash;};
 vm.runInContext(clickSource,c);
 for(const action of ['analyze-plant-photo','new-plant-analysis']){
  await c.click({target:{closest:()=>({dataset:{action,id:'leaf'}})}});
  assert.equal(c.state.scanMethod,preferred||'ecoplant');assert.equal(c.route,'#scan?plant=leaf');assert.equal(c.state.scanOriginalPhoto,c.state.scanPhoto);
 }
 c.state.scanMethod='';c.state.model=null;c.state.profile={modelURL:'https://teachablemachine.withgoogle.com/models/own/'};
 assert.equal(c.selectedScanMethod(),'ecoplant','Existing users get the new default without deleting their custom model.');
 assert.equal(c.customModelURL(),c.state.profile.modelURL);
 c.MODEL_CONFIG.bundledModelAvailable=false;assert.equal(c.selectedScanMethod(),'teachable-machine');
 c.state.profile={};assert.equal(c.selectedScanMethod(),'plant-ai');
}
{
 const c=modelContext({plants:[],scanSymptoms:[],scanNotes:'',scanOriginalPhoto:'',profile:{modelURL:'https://teachablemachine.withgoogle.com/models/own/'}});
 Object.assign(c,{routeParams:()=>new URLSearchParams(),shell:html=>html,heading:()=>'',icon:()=>'',esc:value=>String(value??'')});
 const viewSource=source.slice(source.indexOf('function customScanModelNote('),source.indexOf('function syncScanForm('));
 vm.runInContext(viewSource,c);
 let html=c.scanView();
 assert.match(html, /<option value="ecoplant"[^>]*selected>Modelo EcoPlant — 10 classes/);
 assert.match(html, /<option value="plant-ai"[^>]*>IA geral — 14 culturas/);
 assert.match(html, /<option value="teachable-machine"[^>]*>Meu modelo do Teachable Machine/);
 assert.match(html, /Analisar com o modelo EcoPlant/);
 c.resumeScanRecord({photo:c.state.scanPhoto,result:{method:'teachable-machine',modelURL:'local:ecoplant-model'}});
 html=c.scanView();assert.match(html, /<option value="teachable-machine"[^>]*selected>/);
 assert.match(html, /Para repetir este relatório, selecione novamente os arquivos do modelo original/);
}
// The report action binds to the source used by that report, including a missing import.
for(const [url,expectedMethod] of [['local:ecoplant-model','teachable-machine'],['https://teachablemachine.withgoogle.com/models/older/','teachable-machine'],[bundledURL,'ecoplant'],['','teachable-machine']]){
 const original={id:'older',photo:'data:image/jpeg;base64,AA==',notes:'Anotações anteriores',symptoms:['spots'],result:{method:'teachable-machine',modelURL:url}};
 const c=modelContext({profile:{modelURL:'https://teachablemachine.withgoogle.com/models/newer/'}});
 c.document={addEventListener:(event,fn)=>{c.click=fn;}};c.go=hash=>{c.route=hash;};c.getCurrentReport=()=>original;
 vm.runInContext(clickSource,c);
 await c.click({target:{closest:()=>({dataset:{action:'adjust-report-photo'}})}});
 assert.equal(c.state.scanMethod,expectedMethod);assert.equal(c.scanModelURL(),expectedMethod==='ecoplant'?'./my_model/':url==='local:ecoplant-model'?'':url);
 assert.equal(c.state.scanNotes,original.notes);assert.notEqual(c.state.scanSymptoms,original.symptoms);assert.equal(c.state.scanOriginalPhoto,original.photo);
 assert.equal(original.result.modelURL,url);assert.equal(c.route,'#scan');
 if(url==='local:ecoplant-model'){
  c.classifyPlant=async()=>{throw new Error('An old import must require explicit reconnection before inference');};
  await assert.rejects(c.generateScanReport(scanData('teachable-machine'),()=>{},new AbortController().signal),/não está conectado/);
 }
 if(!url)await assert.rejects(c.generateScanReport(scanData('teachable-machine'),()=>{},new AbortController().signal),/não está conectado/);
}
{
 const importedB={source:'files',metadata:{modelName:'Modelo B'},healthyClass:'Saudável'};
 const c=modelContext({model:importedB});
 const reportA={id:'import-a',photo:c.state.scanPhoto,notes:'Foto analisada pelo modelo A',result:{method:'teachable-machine',modelURL:'local:ecoplant-model',modelName:'Modelo A'}};
 let predictions=0;c.classifyPlant=async()=>{predictions++;return {method:'teachable-machine'};};
 c.resumeScanRecord(reportA);
 assert.equal(c.state.scanFromRecord,true);assert.equal(c.scanModelURL(),'');
 await assert.rejects(c.generateScanReport(scanData('teachable-machine'),()=>{},new AbortController().signal),/não está conectado/);
 assert.equal(predictions,0,'Report A must never silently run already-loaded import B.');
 assert.equal(c.state.model,importedB);assert.equal(c.state.scanNotes,reportA.notes);
 assert.equal(c.state.scanPhoto,reportA.photo);
}
{
 const old={id:'older-ai',photo:'data:image/jpeg;base64,AA==',result:{method:'plant-ai'}};
 const c=modelContext();c.draftKey=()=> 'draft';c.sessionStorage={getItem:()=>JSON.stringify({version:1,record:old})};
 const restoreSource=source.slice(source.indexOf('function restoreDraft('),source.indexOf('function scanFailure('));
 vm.runInContext(restoreSource,c);c.restoreDraft('user');
 assert.equal(c.state.draft.result.method,'plant-ai');assert.equal(c.selectedScanMethod(),'ecoplant','An old draft must not silently become the preference for a new photo.');
 c.resumeScanRecord(c.state.draft);assert.equal(c.selectedScanMethod(),'plant-ai','An explicit retry still uses the old method.');
}
console.log('PASS new defaults, explicit choices, old draft preservation and original source on retry without model fallback');

// Run the real loading module against a minimal DOM. No inference is simulated here.
const nodes=new Map(),events=new Map();let timer=0;const timers=new Map();
class Element {
 constructor(){this.children=new Map();this.listeners=new Map();this.style={};this.dataset={};this.hidden=false;this.isConnected=true;this.classList={add(){},remove(){}};}
 querySelector(selector){if(!this.children.has(selector))this.children.set(selector,new Element());return this.children.get(selector);}
 addEventListener(type,listener){this.listeners.set(type,listener);}
 appendChild(element){if(element.id)nodes.set(element.id,element);}
 setAttribute(){}
 remove(){this.isConnected=false;}
 contains(element){return element===this||[...this.children.values()].some(child=>child.contains(element));}
 focus(){document.activeElement=this;}
 click(){this.listeners.get('click')?.({});}
}
const body=new Element(),previous=new Element();
globalThis.document={body,head:new Element(),activeElement:previous,getElementById:id=>nodes.get(id)||null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>new Element(),addEventListener:(type,listener)=>events.set(type,listener)};
globalThis.window={matchMedia:()=>({matches:false})};
globalThis.setTimeout=(fn)=>{timers.set(++timer,fn);return timer;};globalThis.clearTimeout=id=>timers.delete(id);
const exp=await import(root+'/dist/experience.js');
let cancelled=0;
const first=exp.showLoading('Download',{onCancel:()=>cancelled++});
const overlay=nodes.get('eco-loading'),button=overlay.querySelector('.eco-loading-cancel');
assert.equal(button.hidden,false);
const second=exp.showLoading('Salvando');assert.equal(button.hidden,true);
exp.updateLoading('Progresso antigo',first);assert.equal(overlay.querySelector('.eco-loading-message').textContent,'Salvando');
exp.hideLoading(second);assert.equal(button.hidden,false);button.click();assert.equal(cancelled,1);assert.equal(overlay.hidden,true);
exp.updateLoading('Resultado tardio',first);exp.hideLoading(first);assert.equal(overlay.hidden,true);
exp.showLoading('Outra análise',{onCancel:()=>cancelled++});events.get('keydown')({key:'Escape',preventDefault(){}});assert.equal(cancelled,2);assert.equal(overlay.hidden,true);
console.log('PASS cancellation button and Escape release overlay; stale progress cannot replace a newer operation');
