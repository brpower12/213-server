const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const Core=require('../game-data-core.js');

test('observation SQL enforces authorization, atomic validation, dedupe and table isolation',async()=>{
  const db=new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
      SELECT current_setting('request.jwt.claim.role',true)
    $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    CREATE TABLE public.test_editor_profiles(name text, device text, profile jsonb);
    CREATE FUNCTION public.get_editor_profile(p_name text,p_device_id text)
      RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
      SELECT profile FROM public.test_editor_profiles WHERE name=p_name AND device=p_device_id
    $$;
    INSERT INTO public.test_editor_profiles VALUES
      ('approved','device','{"device_status":"approved","role":"operator","perms":"rank, entry"}'),
      ('admin','device','{"device_status":"approved","role":"admin","perms":""}'),
      ('pending','device','{"device_status":"pending","role":"admin","perms":"*"}'),
      ('missing-status','device','{"role":"admin","perms":"*"}'),
      ('viewer','device','{"device_status":"approved","role":"operator","perms":"rank"}');
  `);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/202611190001_game_observations.sql'),'utf8'));
  const session=async(role,uid='00000000-0000-4000-8000-000000000213')=>{
    await db.query("SELECT set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)",[role,uid]);
  };
  const read=async(actor='approved')=>(await db.query('SELECT public.dw_game_observations_list($1,$2) AS data',[actor,'device'])).rows[0].data;
  const write=async(rows,actor='approved')=>(await db.query('SELECT public.dw_game_observations_import($1,$2,$3::jsonb) AS data',[actor,'device',JSON.stringify(rows)])).rows[0].data;
  const row={uid:'1234567890000213',name:'Test',total_power:123,migration_power:0,observed_at:'2026-11-19T00:00:00Z',source:'get.new.user.info'};
  try{
    await session('anon','');await assert.rejects(read(),/Authenticated session required/);
    await session('authenticated','');await assert.rejects(write([row]),/Authenticated session required/);
    await session('authenticated');
    for(const actor of ['pending','missing-status','viewer','unknown']){
      await assert.rejects(read(actor),/Approved device/);
      await assert.rejects(write([row],actor),/Approved device/);
    }
    assert.deepEqual(await read(),[]);
    assert.deepEqual(await write([row]),{inserted:1,duplicates:0});
    assert.deepEqual(await write([{...row,observed_at:'2026-11-19T09:00:00+09:00'}]),{inserted:0,duplicates:1});
    assert.deepEqual(await write([{...row,hero_power:null}]),{inserted:0,duplicates:1});
    const found=await read();
    assert.equal(found.length,1);assert.equal(found[0].uid,row.uid);assert.equal(found[0].migration_power,0);
    assert.ok(!Object.hasOwn(found[0],'hero_power'));assert.equal(found[0].imported_by,'approved');
    assert.equal(Core.normalize({schema_version:1,observations:found})[0].total_power,123);
    for(const bad of [
      {...row,token:'DO-NOT-STORE'}, {...row,uid:123456789},
      {...row,observed_at:'2026-11-19T00:00:00'}, {...row,total_power:-1},
      {...row,total_power:1.5}, {...row,total_power:9007199254740992},
      {...row,total_power:true}, {...row,source:'unknown.command'}
    ]){
      await assert.rejects(write([{...row,uid:'1234567890000214'},bad]));
      assert.equal((await read()).length,1,'the valid first row must roll back with the invalid second row');
    }
    await assert.rejects(write(Array(501).fill(row)),/1-500 rows/);
    assert.deepEqual(await write([{...row,total_power:124}],'admin'),{inserted:1,duplicates:0});
    assert.equal((await read()).length,2);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query('SELECT * FROM public.dw_game_observations'),/permission denied/);
    await assert.rejects(db.query("INSERT INTO public.dw_game_observations(uid) VALUES ('123456')"),/permission denied/);
    assert.equal((await read()).length,2,'authenticated callers can use the checked SECURITY DEFINER RPC');
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(read(),/permission denied/);
    await db.exec('RESET ROLE');
  }finally{await db.close();}
});
