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
{
 const state={scanPhoto:'data:image/jpeg;base64,AA==',model:{source:'files',healthyClass:'Saudável'},profile:{healthyClass:'Outra classe'}};
 const output={method:'teachable-machine',modelURL:'local:ecoplant-model',modelLabels:['Saudável','Mancha'],topClass:'Saudável',confidence:.96,predictions:[{className:'Saudável',probability:.96},{className:'Mancha',probability:.04}]};
 let resolvePrediction, started;
 const ready=new Promise(resolve=>{started=resolve;});
 const c={state,photoSafe:v=>v,findPlant:()=>null,SYMPTOMS:[],scanFailure:m=>new Error(m),activeModelURL:()=> 'local:ecoplant-model',uuid:()=> 'analysis-1',classifyPlant:async()=>{started();return new Promise(resolve=>{resolvePrediction=resolve;});},Image:class {set src(value){queueMicrotask(()=>this.onload());}},console};
 vm.createContext(c);vm.runInContext(scanSource,c);
 const data={get:k=>({plantId:'',notes:'Folha do aluno',method:'teachable-machine'})[k],getAll:()=>[]};
 const pending=c.generateScanReport(data,()=>{},new AbortController().signal);
 await ready;state.model.healthyClass='Mancha';resolvePrediction(output);
 const record=await pending;
 assert.equal(record.result.title,'Classe saudável no modelo');assert.match(record.result.summary,/classe saudável selecionada/);assert.equal('healthyClass' in record.result,false);
 assert.equal(record.notes,'Folha do aluno');assert.equal(record.photo,state.scanPhoto);
}
console.log('PASS TM healthy-class snapshot survives later configuration changes without new Firebase fields');
// Exercise the actual card click handlers: a custom model must stay selected.
const methodSource=source.slice(source.indexOf('function selectedScanMethod('),source.indexOf('function activeModelSource('));
const clickSource=source.slice(source.indexOf("document.addEventListener('click',async e=>{"),source.indexOf("document.addEventListener('submit',async e=>{"));
for(const preferred of ['teachable-machine','plant-ai','guided','']){
 const c={state:{scanMethod:preferred,scanPhoto:'',scanOriginalPhoto:''},activeModelURL:()=> 'local:ecoplant-model',photoSafe:v=>v,findPlant:()=>({id:'leaf',photo:'data:image/jpeg;base64,AA=='}),document:{addEventListener:(event,fn)=>{c.click=fn;}},go:hash=>{c.route=hash;},scanFailure:message=>new Error(message),console};
 vm.createContext(c);vm.runInContext(methodSource+'\n'+clickSource,c);
 for(const action of ['analyze-plant-photo','new-plant-analysis']){
  const button={dataset:{action,id:'leaf'}};
  await c.click({target:{closest:()=>button}});
  assert.equal(c.state.scanMethod,preferred||'teachable-machine');
  assert.equal(c.route,'#scan?plant=leaf');
  assert.equal(c.state.scanOriginalPhoto,c.state.scanPhoto);
 }
 c.activeModelURL=()=>'';c.state.scanMethod='teachable-machine';
 assert.equal(c.selectedScanMethod(),'teachable-machine','A missing imported model requires reconnection, not a silent switch');
 c.state.scanMethod='';assert.equal(c.selectedScanMethod(),'plant-ai');
}
console.log('PASS plant-card actions preserve the selected model; missing local models never silently switch');

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
