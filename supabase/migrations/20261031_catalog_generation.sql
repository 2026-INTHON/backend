-- Shared curriculum content and private, durable generation work.
BEGIN;
CREATE TABLE IF NOT EXISTS public.malo_catalog (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('character','chapter','scene','background')),
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS malo_catalog_kind_idx ON public.malo_catalog(kind);

CREATE TABLE IF NOT EXISTS public.malo_generation_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid REFERENCES public.malo_profiles(id),
  request_key text NOT NULL UNIQUE,
  client_request_id uuid NOT NULL,
  request_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('personal','catalog')),
  status text NOT NULL CHECK (status IN ('queued','running','ready','failed')),
  stage text NOT NULL DEFAULT 'queued',
  request jsonb NOT NULL,
  checkpoint jsonb NOT NULL DEFAULT '{}',
  chapter_id text,
  error jsonb,
  attempts integer NOT NULL DEFAULT 0,
  worker_token uuid,
  lease_until timestamptz,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='personal' AND owner_id IS NOT NULL) OR (kind='catalog' AND owner_id IS NULL))
);
CREATE INDEX IF NOT EXISTS malo_generation_owner_idx ON public.malo_generation_jobs(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS malo_generation_queue_idx ON public.malo_generation_jobs(status,created_at);

CREATE TABLE IF NOT EXISTS public.malo_user_chapters (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.malo_profiles(id),
  job_id uuid NOT NULL UNIQUE REFERENCES public.malo_generation_jobs(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS malo_user_chapters_owner_idx ON public.malo_user_chapters(owner_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.malo_push_subscriptions (
  id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.malo_profiles(id),
  subscription jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS malo_push_owner_idx ON public.malo_push_subscriptions(owner_id);

ALTER TABLE public.malo_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.malo_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.malo_user_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.malo_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.malo_catalog,public.malo_generation_jobs,public.malo_user_chapters,public.malo_push_subscriptions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.malo_catalog,public.malo_generation_jobs,public.malo_user_chapters,public.malo_push_subscriptions TO service_role;

CREATE OR REPLACE FUNCTION public.malo_claim_generation_job(worker uuid)
RETURNS SETOF public.malo_generation_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE malo_generation_jobs SET status='failed',stage='failed',worker_token=NULL,lease_until=NULL,
    error='{"code":"GENERATION_INTERRUPTED","message":"생성 작업이 중단됐어요. 다시 시도해 주세요.","retryable":true}',updated_at=now()
    WHERE status='running' AND lease_until<now() AND attempts>=2;
  RETURN QUERY UPDATE malo_generation_jobs SET status='running',worker_token=worker,
    lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
    WHERE id=(SELECT id FROM malo_generation_jobs
      WHERE attempts<2 AND (status='queued' OR (status='running' AND lease_until<now()))
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.malo_claim_generation_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.malo_claim_generation_job(uuid) TO service_role;

-- Keep private libraries, work and device subscriptions together during guest upgrade.
CREATE OR REPLACE FUNCTION public.malo_merge_profiles(
  guest_id uuid,target_id uuid,guest_version integer,target_version integer,target_document jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE source_row malo_profiles%ROWTYPE; destination_row malo_profiles%ROWTYPE;
BEGIN
  IF guest_id=target_id THEN RETURN true; END IF;
  PERFORM id FROM malo_profiles WHERE id IN (guest_id,target_id) ORDER BY id FOR UPDATE;
  SELECT * INTO source_row FROM malo_profiles WHERE id=guest_id;
  SELECT * INTO destination_row FROM malo_profiles WHERE id=target_id;
  IF source_row.id IS NULL OR destination_row.id IS NULL OR source_row.version<>guest_version OR destination_row.version<>target_version THEN RETURN false; END IF;
  IF source_row.document->>'kind'<>'guest' OR source_row.document->>'mergedInto' IS NOT NULL THEN RAISE EXCEPTION 'Invalid guest merge'; END IF;
  UPDATE malo_profiles SET document=target_document,version=version+1,updated_at=now() WHERE id=target_id;
  UPDATE malo_profiles SET document=jsonb_set(jsonb_set(jsonb_set(document,'{mergedInto}',to_jsonb(target_id::text)),'{authVersion}',to_jsonb((document->>'authVersion')::integer+1)),'{state,refreshTokens}','[]'::jsonb),version=version+1,updated_at=now() WHERE id=guest_id;
  UPDATE malo_generation_jobs SET owner_id=target_id WHERE owner_id=guest_id;
  UPDATE malo_user_chapters SET owner_id=target_id WHERE owner_id=guest_id;
  UPDATE malo_push_subscriptions SET owner_id=target_id WHERE owner_id=guest_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.malo_merge_profiles(uuid,uuid,integer,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.malo_merge_profiles(uuid,uuid,integer,integer,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT jsonb_object_agg(c.relname,c.relrowsecurity) AS protected_tables,
  has_function_privilege('anon','public.malo_claim_generation_job(uuid)','EXECUTE') AS anonymous_job_claim_allowed
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('malo_catalog','malo_generation_jobs','malo_user_chapters','malo_push_subscriptions');
