-- Publish content and complete its job atomically, using its current owner after guest migration.
CREATE OR REPLACE FUNCTION public.malo_publish_chapter(job uuid,worker uuid,chapter text,content jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j malo_generation_jobs;
BEGIN
  SELECT * INTO j FROM malo_generation_jobs WHERE id=job AND worker_token=worker AND status='running' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Generation lease lost'; END IF;
  IF j.kind='catalog' THEN
    INSERT INTO malo_catalog(id,kind,document) VALUES(chapter,'chapter',content)
      ON CONFLICT(id) DO UPDATE SET document=excluded.document,updated_at=now();
  ELSE
    INSERT INTO malo_user_chapters(id,owner_id,job_id,document) VALUES(chapter::uuid,j.owner_id,job,content)
      ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,document=excluded.document;
  END IF;
  UPDATE malo_generation_jobs SET status='ready',stage='ready',chapter_id=chapter,error=NULL,updated_at=now() WHERE id=job;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.malo_publish_chapter(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.malo_publish_chapter(uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
SELECT has_function_privilege('anon','public.malo_publish_chapter(uuid,uuid,text,jsonb)','EXECUTE') AS anonymous_publish_allowed;
