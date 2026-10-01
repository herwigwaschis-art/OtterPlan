import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const src=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/manage-teacher-account/index.ts',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,''));
async function run({anonymous=false,authorized=false,validClasses=true,action='create'}={}){
 let handler,calls=[];
 const admin={auth:{getUser:async()=>({data:{user:{id:'synthetic',is_anonymous:anonymous}}}),admin:{listUsers:async()=>{calls.push('lookup');return{data:{users:[]}}},inviteUserByEmail:async()=>{calls.push('invite');return{data:{user:{id:'invited'}}}}}}};
 const user={rpc:async(name)=>{calls.push(name);return {data:name==='is_school_admin'?authorized:name==='authorize_teacher_provisioning'?validClasses:true,error:null}}};
 vm.runInNewContext(src,{Deno:{env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'service':'public'},serve:f=>handler=f},createClient:(url,key)=>key==='service'?admin:user,Request,Response});
 const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({action,school_id:'synthetic-school',email:'test@example.invalid',display_name:'Synthetic',class_ids:[]})}));
 return {response,calls};
}
test('anonymous caller rejected before privileged lookup or invitation',async()=>{const {response,calls}=await run({anonymous:true});assert.equal(response.status,403);assert.deepEqual(calls,[])});
test('regular teacher rejected before privileged lookup or invitation',async()=>{const {response,calls}=await run();assert.equal(response.status,403);assert.deepEqual(calls,['is_school_admin'])});
test('invalid school/class assignment rejected before invitation',async()=>{const {response,calls}=await run({authorized:true,validClasses:false});assert.equal(response.status,403);assert.equal(calls.includes('invite'),false)});
test('authorized admin invitation occurs only after both permission checks',async()=>{const {response,calls}=await run({authorized:true});assert.equal((await response.json()).ok,true);assert.deepEqual(calls,['is_school_admin','authorize_teacher_provisioning','lookup','invite','configure_teacher_account'])});
