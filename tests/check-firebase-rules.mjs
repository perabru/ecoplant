import fs from 'node:fs';
import assert from 'node:assert/strict';
const rules = JSON.parse(fs.readFileSync('setup/database.rules.json','utf8'));
const same = JSON.parse(fs.readFileSync('setup/Ecoplant_Regras_Para_Copiar.txt','utf8'));
assert.deepEqual(rules,same);
const present=v=>v!=null&&(typeof v!=='object'||Object.keys(v).length>0);
function snapshot(v){return{val:()=>v,isString:()=>typeof v==='string',isNumber:()=>typeof v==='number'&&Number.isFinite(v),isBoolean:()=>typeof v==='boolean',hasChildren:keys=>v!==null&&typeof v==='object'&&(keys?keys.every(k=>present(v[k])):Object.keys(v).some(k=>present(v[k]))),child:k=>snapshot(v?.[k]),exists:()=>present(v)}}
String.prototype.matches=function(regex){return regex.test(String(this))};
let compiled=0;
function compile(node){for(const [k,v]of Object.entries(node)){if(k.startsWith('.')&&typeof v==='string'){new Function('auth','newData','data','root','$uid','$id','$index','return ('+v+')');compiled++}else if(v&&typeof v==='object'&&!Array.isArray(v))compile(v)}}
compile(rules);
const urlExpression=rules.rules.ecoplant.users.$uid.profile.modelURL['.validate'];
const literal=urlExpression.match(/\.matches\((\/.*\/)\)/)[1];
const rx=new Function('return '+literal)();
assert(rx.test('https://teachablemachine.withgoogle.com/models/REAL_id-1/'));
assert(!rx.test('https://example.com/models/REAL_id-1/'));
function validate(node,v,env={}){if(!present(v))return true;const expr=node['.validate'];if(expr===false)return false;if(typeof expr==='string'&&!new Function('newData','$uid','$id','$index','return ('+expr+')')(snapshot(v),env.$uid,env.$id,env.$index))return false;if(typeof v==='object'){for(const[k,x]of Object.entries(v)){let child=node[k],next=env;if(!child){const wildcard=Object.keys(node).find(n=>n.startsWith('$'));if(!wildcard)return false;child=node[wildcard];next={...env,[wildcard]:k}}if(!validate(child,x,next))return false}}return true}
const triageCode=fs.readFileSync('dist/triage.js','utf8');
const {evaluateSymptoms}=await import('data:text/javascript;base64,'+Buffer.from(triageCode).toString('base64'));
const userRules=rules.rules.ecoplant.users.$uid;
const profile={displayName:'Teste',email:'teste@example.com',createdAt:1,modelURL:'https://teachablemachine.withgoogle.com/models/REAL_id-1/',healthyClass:'Saudável'};
const base={profile,plants:{p1:{id:'p1',name:'Tomateiro',createdAt:1,updatedAt:1}},analyses:{a1:{id:'a1',date:new Date().toISOString(),plantId:'p1',result:evaluateSymptoms(['spots','yellow'])}}};
assert(validate(userRules,base,{$uid:'u1'}),'guided fixture must validate');
base.analyses.a1.result=evaluateSymptoms(['healthy']);
assert(validate(userRules,base,{$uid:'u1'}),'empty possibilities are omitted as Firebase does');
const tm={method:'teachable-machine',modelURL:profile.modelURL,modelName:'Ecoplant',modelLabels:['Saudável','Mancha foliar'],predictions:[{className:'Saudável',probability:0.8},{className:'Mancha foliar',probability:0.2}],topClass:'Saudável',confidence:0.8,analyzedAt:new Date().toISOString()};
base.analyses.a1.result=tm;
assert(validate(userRules,base,{$uid:'u1'}),'TM fixture must validate');
for(const modelURL of ['local:ecoplant-model','https://perabru.github.io/ecoplant/my_model/']){
  base.analyses.a1.result={...tm,modelURL};
  assert(validate(userRules,base,{$uid:'u1'}),'imported and bundled reports must fit the existing Firebase schema');
}
base.analyses.a1.result=tm;
assert(!validate(userRules,'bad',{$uid:'u1'}));
assert(!validate(userRules,{...base,plants:'bad'},{$uid:'u1'}));
assert(!validate(userRules,{...base,profile:{email:'teste@example.com'}},{$uid:'u1'}));
assert(!validate(userRules,{...base,profile:{...profile,modelURL:'https://example.com/models/invalid'}},{$uid:'u1'}));
base.analyses.a1.result={...tm,confidence:1.2};
assert(!validate(userRules,base,{$uid:'u1'}),'invalid confidence must be rejected');
base.analyses.a1.result={...tm,extra:'unexpected'};
assert(!validate(userRules,base,{$uid:'u1'}),'unknown result field must be rejected');
console.log('Compiled '+compiled+' expressions; regex, guided/TM fixtures, structural and bounds checks passed. Local simulation only; no cloud rules changed.');
