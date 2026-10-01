// Requires an explicitly selected isolated project. Never run against production.
import fs from 'node:fs';import assert from 'node:assert/strict';
const config=JSON.parse(fs.readFileSync(process.env.MILO_STAGING_CONFIG||'../milo-staging-private/config.json'));
assert.equal(config.url,'https://guylpckclydelojwomfe.supabase.co','Refuse non-test project');
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const results=[],tokens={};
async function request(path,{token,body,method}={}){
 const r=await fetch(config.url+path,{method:method||(body?'POST':'GET'),headers:{apikey:config.key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={error:'Non-JSON response'}}return {status:r.status,data};
}
async function check(name,fn){try{await fn();results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message});throw e}finally{fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/staging-http.json',JSON.stringify(results,null,2));}}
try{
 const settings=await request('/auth/v1/settings');console.log('Anonymous sign-in enabled:',settings.data.external?.anonymous_users);fs.writeFileSync('../milo-staging-private/auth-settings.json',JSON.stringify(settings.data));
 for(const name of ['admin','teacher','child-a','child-b','outsider'])await check('Real Auth password login '+name,async()=>{const r=await request('/auth/v1/token?grant_type=password',{body:{email:'milo-security-'+name+'@example.invalid',password:config.password}});assert.equal(r.status,200,JSON.stringify({status:r.status,error:r.data.error_code||r.data.msg}));assert.ok(r.data.access_token);tokens[name]=r.data.access_token});
 // Re-establish the synthetic teacher fixture so the revocation test is repeatable.
 assert.equal((await request('/rest/v1/rpc/configure_teacher_account',{token:tokens.admin,body:{p_user_id:id(2),p_school_id:id(10),p_display_name:'Synthetic teacher',p_role:'teacher',p_class_ids:[id(20)],p_grade_levels:[2],p_must_change_password:false}})).status,204);
 await check('Public API denies pupil rows',async()=>{const r=await request('/rest/v1/students?select=id');assert.equal(r.status,401)});
 await check('Unassigned account sees no children',async()=>{const r=await request('/rest/v1/students?select=id',{token:tokens.outsider});assert.equal(r.status,200);assert.deepEqual(r.data,[])});
 await check('Teacher sees assigned class',async()=>{const r=await request('/rest/v1/students?select=id',{token:tokens.teacher});assert.equal(r.status,200);assert.equal(r.data.length,2)});
 for(const name of ['teacher','admin'])await check('Admin hash hidden from '+name,async()=>{const r=await request('/rest/v1/school_settings?select=admin_access_hash',{token:tokens[name]});assert.equal(r.status,403)});
 for(const name of ['child-a','teacher','outsider'])await check('Edge rejects invitation before side effects '+name,async()=>{const r=await request('/functions/v1/manage-teacher-account',{token:tokens[name],body:{action:'create',school_id:id(10),email:'never-send@example.invalid',display_name:'Denied'}});assert.equal(r.status,403,'Expected application authorization denial, got '+r.status)});
 await check('Edge accepts admin JWT without sending email',async()=>{const r=await request('/functions/v1/manage-teacher-account',{token:tokens.admin,body:{action:'test-no-side-effect',school_id:id(10)}});assert.equal(r.status,200);assert.equal(r.data.ok,false);assert.equal(r.data.error,'Unbekannte Aktion')});
 const qr=await request('/rest/v1/rpc/reset_child_qr_code',{token:tokens.admin,body:{p_student_id:id(30)}});assert.equal(qr.status,200);const oldToken=qr.data[0].qr_token;
 await check('Real anonymous-account JWT redeems child QR',async()=>{const r=await request('/rest/v1/rpc/redeem_child_qr',{token:tokens['child-a'],body:{p_qr_token:oldToken}});assert.equal(r.status,200);assert.equal(r.data,id(30))});
 await check('Child sees only linked pupil through REST',async()=>{const r=await request('/rest/v1/students?select=id',{token:tokens['child-a']});assert.deepEqual(r.data,[{id:id(30)}])});
 await check('Other child cannot read first child',async()=>{const r=await request('/rest/v1/students?select=id',{token:tokens['child-b']});assert.deepEqual(r.data,[])});
 await check('QR rotation revokes existing JWT access',async()=>{assert.equal((await request('/rest/v1/rpc/reset_child_qr_code',{token:tokens.admin,body:{p_student_id:id(30)}})).status,200);const r=await request('/rest/v1/students?select=id',{token:tokens['child-a']});assert.deepEqual(r.data,[]);assert.equal((await request('/rest/v1/rpc/redeem_child_qr',{token:tokens['child-a'],body:{p_qr_token:oldToken}})).status,400)});
 await check('Remove school teacher revokes existing JWT immediately',async()=>{assert.equal((await request('/rest/v1/rpc/remove_school_member',{token:tokens.admin,body:{p_school_id:id(10),p_user_id:id(2)}})).status,204);const r=await request('/rest/v1/students?select=id',{token:tokens.teacher});assert.deepEqual(r.data,[])});
}finally{
 for(const token of Object.values(tokens))await request('/auth/v1/logout?scope=local',{token,method:'POST'});
 console.log(JSON.stringify(results,null,2));
}
