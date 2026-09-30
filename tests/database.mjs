import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url), c=JSON.parse(fs.readFileSync(new URL('supabase/baseline/catalog.json',root)));
export async function database(){
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, is_anonymous boolean DEFAULT false, raw_user_meta_data jsonb DEFAULT '{}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated,anon;
 SET check_function_bodies=off;`);
 for(const t of c.schema.tables)await db.exec(t.ddl);
 for(const k of c.schema.constraints.filter(x=>x.type!=='f'))await db.exec(`ALTER TABLE public.${k.table.replace('public.','')} ADD CONSTRAINT "${k.name}" ${k.definition}`);
 for(const k of c.schema.constraints.filter(x=>x.type==='f'))await db.exec(`ALTER TABLE public.${k.table.replace('public.','')} ADD CONSTRAINT "${k.name}" ${k.definition}`);
 for(const f of c.functions)await db.exec(f.definition);
 // Match deployed function ACLs, not PostgreSQL's default PUBLIC EXECUTE.
 for(const f of c.functions){const signature=f.definition.match(/FUNCTION public\.([^\n]+)\n/)[1];
  const reg=(await db.query("select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[f.name])).rows;
  for(const {sig} of reg){await db.exec(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,anon,authenticated`);if(f.acl.includes('authenticated=X'))await db.exec(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated`);}
 }
 for(const t of c.schema.triggers)await db.exec(t);
 for(const t of c.schema.tables){if(t.rls)await db.exec(`ALTER TABLE public.${t.name} ENABLE ROW LEVEL SECURITY`);
  for(const role of ['anon','authenticated']){const a=t.acl.find(x=>x.startsWith(role+'='));if(!a)continue;const chars=a.split('=')[1].split('/')[0];const map={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN'};for(const ch of chars)if(map[ch])await db.exec(`GRANT ${map[ch]} ON public.${t.name} TO ${role}`);}
 }
 for(const p of c.policies)await db.exec(`CREATE POLICY "${p.policyname}" ON public.${p.tablename} AS ${p.permissive} FOR ${p.cmd} TO ${Array.isArray(p.roles)?p.roles.join(','):p.roles.slice(1,-1)} ${p.qual?'USING ('+p.qual+')':''} ${p.with_check?'WITH CHECK ('+p.with_check+')':''}`);
 return db;
}
export async function migrate(db){await db.exec(fs.readFileSync(new URL('supabase/migrations/20260930082816_prelaunch_security_hardening.sql',root),'utf8'));}
export const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export async function actor(db,n,anon=false){await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id(n)}',false); SELECT set_config('request.jwt.claims','${JSON.stringify({sub:id(n),is_anonymous:anon})}',false); SET ROLE authenticated`);}
export async function owner(db){await db.exec('RESET ROLE');}
if(process.argv[1]===new URL(import.meta.url).pathname){const db=await database();await migrate(db);console.log('Baseline and migration applied in isolated PostgreSQL '+(await db.query('select version()')).rows[0].version);await db.close();}
