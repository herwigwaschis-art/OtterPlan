import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,migrate,id,actor,owner} from './database.mjs';
const db=await database();
// Artificial identities only; no production rows or credentials.
await db.exec(`INSERT INTO auth.users(id,email,is_anonymous,raw_user_meta_data) VALUES
 ('${id(1)}','admin@example.invalid',false,'{"account_type":"teacher"}'),
 ('${id(2)}','teacher@example.invalid',false,'{"account_type":"teacher"}'),
 ('${id(3)}',null,true,'{}'),('${id(4)}',null,true,'{}');
 INSERT INTO public.schools(id,name,created_by) VALUES('${id(10)}','Testschule','${id(1)}');
 INSERT INTO public.school_members(school_id,user_id,role) VALUES('${id(10)}','${id(1)}','admin'),('${id(10)}','${id(2)}','teacher');
 INSERT INTO public.school_settings(school_id,admin_access_hash) VALUES('${id(10)}',extensions.crypt('synthetic-only',extensions.gen_salt('bf')));
 INSERT INTO public.classes(id,name,teacher_id,school_id,grade_level) VALUES('${id(20)}','Testklasse','${id(2)}','${id(10)}',2);
 INSERT INTO public.class_teacher_links(class_id,user_id) VALUES('${id(20)}','${id(1)}');
 INSERT INTO public.grade_teacher_links(school_id,grade_level,user_id) VALUES('${id(10)}',2,'${id(2)}');
 INSERT INTO public.students(id,class_id,display_name) VALUES('${id(30)}','${id(20)}','Testkind A'),('${id(31)}','${id(20)}','Testkind B');
 INSERT INTO public.student_device_links(user_id,student_id) VALUES('${id(3)}','${id(30)}'),('${id(4)}','${id(31)}');
 INSERT INTO public.weekly_plans(student_id,week_start,goal) VALUES('${id(30)}','2026-09-28','Testziel');
 INSERT INTO public.ratings(student_id,week_start,weekday,lesson_no,rating,updated_by) VALUES('${id(30)}','2026-09-28',1,1,'good','${id(2)}');`);
const before=(await db.query('select row_to_json(p) as value from public.weekly_plans p')).rows;
await migrate(db);
after(()=>db.close());
async function value(sql){return Object.values((await db.query(sql)).rows[0])[0]}
test('migration preserves history and existing teacher access',async()=>{
 assert.deepEqual((await db.query('select row_to_json(p) as value from public.weekly_plans p')).rows,before);
 await actor(db,2);assert.equal(await value(`select public.is_teacher_of_class('${id(20)}')`),true);
 assert.equal(await value('select count(*)::int from public.students'),2);
});
test('registration metadata cannot create a teacher, including anonymous signup',async()=>{
 await owner(db);for(const [n,anonymous] of [[5,true],[6,false]]){
 await db.exec(`INSERT INTO auth.users(id,is_anonymous,raw_user_meta_data) VALUES('${id(n)}',${anonymous},'{"account_type":"teacher"}')`);
 assert.equal(await value(`select role from public.profiles where id='${id(n)}'`),'student');
 await actor(db,n,anonymous);assert.equal(await value('select public.is_teacher_role()'),false);
 await assert.rejects(db.query("select public.create_school('Unauthorized')"));await owner(db);
 }
});
test('school admin check denies pupils and regular teachers before provisioning',async()=>{
 for(const n of [2,3,5,6]){await actor(db,n,n===3||n===5);assert.equal(await value(`select public.authorize_teacher_provisioning('${id(10)}','{}','{}')`),false)}
 await actor(db,1);assert.equal(await value(`select public.authorize_teacher_provisioning('${id(10)}',array['${id(20)}']::uuid[],array[2]::smallint[])`),true);
 assert.equal(await value(`select public.authorize_teacher_provisioning('${id(10)}',array['${id(999)}']::uuid[],'{}')`),false);
 await assert.rejects(db.query(`select public.configure_teacher_account('${id(3)}','${id(10)}','Wrong','teacher','{}','{}',false)`));
});
test('admin hash denied, safe settings readable, password verification still works',async()=>{
 for(const n of [1,2]){await actor(db,n);assert.equal(await value('select count(school_id)::int from public.school_settings'),1);
 await assert.rejects(db.query('select admin_access_hash from public.school_settings'));
 await assert.rejects(db.query('select * from public.school_settings'));}
 await actor(db,1);assert.equal(await value(`select public.verify_school_admin_code('${id(10)}','synthetic-only')`),true);
});
test('child isolation and note template ownership',async()=>{
 await actor(db,3,true);assert.deepEqual((await db.query('select id from public.students')).rows,[{id:id(30)}]);
 await assert.rejects(db.query(`insert into public.teacher_note_templates(teacher_id,body) values('${id(3)}','No')`));
 await actor(db,1);await db.exec(`insert into public.teacher_note_templates(teacher_id,body) values('${id(1)}','Template')`);
 await actor(db,2);assert.equal(await value('select count(*)::int from public.teacher_note_templates'),0);
});
test('QR rotation revokes linked sessions and rejects the previous card',async()=>{
 await actor(db,1);const old=await value(`select qr_token from public.reset_child_qr_code('${id(30)}')`);
 await actor(db,3,true);assert.equal(await value(`select public.is_child_student('${id(30)}')`),false);
 await db.query('select public.redeem_child_qr($1)',[old]);assert.equal(await value(`select public.is_child_student('${id(30)}')`),true);
 await actor(db,1);const next=await value(`select qr_token from public.reset_child_qr_code('${id(30)}')`);assert.notEqual(old,next);
 await actor(db,3,true);await assert.rejects(db.query('select public.redeem_child_qr($1)',[old]));
 assert.equal(await value(`select public.is_child_student('${id(30)}')`),false);await db.query('select public.redeem_child_qr($1)',[next]);
 await actor(db,1);await db.exec(`select public.revoke_child_devices('${id(30)}')`);
 await actor(db,3,true);await assert.rejects(db.query('select public.redeem_child_qr($1)',[next]));
 assert.equal(await value(`select public.is_child_student('${id(30)}')`),false);
});
test('archived pupil cannot redeem a valid card',async()=>{
 await actor(db,1);const token=await value(`select qr_token from public.reset_child_qr_code('${id(30)}')`);
 await owner(db);await db.exec(`update public.students set archived_at=now() where id='${id(30)}'`);
 await actor(db,3,true);await assert.rejects(db.query('select public.redeem_child_qr($1)',[token]));
 await owner(db);await db.exec(`update public.students set archived_at=null where id='${id(30)}'`);
});
test('new school classes remain accessible to their creator',async()=>{
 await actor(db,1);const cid=await value(`select public.create_class_for_school('${id(10)}','New',2::smallint,'2026/27')`);
 assert.equal(await value(`select public.is_teacher_of_class('${cid}')`),true);
});
test('class removal cannot be bypassed through historical owner identity',async()=>{
 await actor(db,1);await db.exec(`select public.remove_teacher_from_class('${id(20)}','${id(2)}')`);
 await actor(db,2);assert.equal(await value(`select public.is_teacher_of_class('${id(20)}')`),false);
 assert.equal(await value(`select public.is_class_admin('${id(20)}')`),false);
 await assert.rejects(db.query(`select public.update_class_settings('${id(20)}','Wrong','2026/27',2::smallint)`));
});
test('school removal closes grade, class, owner and write access immediately',async()=>{
 await actor(db,1);await db.exec(`select public.remove_school_member('${id(10)}','${id(2)}')`);
 await actor(db,2);assert.equal(await value(`select public.has_grade_access('${id(10)}',2::smallint)`),false);
 assert.equal(await value(`select public.is_teacher_of_class('${id(20)}')`),false);
 assert.equal(await value('select count(*)::int from public.students'),0);
 await assert.rejects(db.query(`select public.grade_get_student_week('${id(30)}','2026-09-28')`));
 await assert.rejects(db.query(`insert into public.ratings(student_id,week_start,weekday,lesson_no,rating,updated_by) values('${id(30)}','2026-09-28',1,2,'good','${id(2)}')`));
 await owner(db);assert.equal(await value('select count(*)::int from public.ratings'),1);
});
