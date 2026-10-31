-- Single-user snapshots keep the hackathon mock deterministic and persistent.
-- Move growing histories into normalized tables before expanding beyond the MVP.
CREATE TABLE IF NOT EXISTS public.malo_profiles (
  id uuid PRIMARY KEY,
  version integer NOT NULL DEFAULT 0,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.malo_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.malo_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.malo_profiles TO service_role;

CREATE OR REPLACE FUNCTION public.malo_merge_profiles(
  guest_id uuid, target_id uuid, guest_version integer, target_version integer, target_document jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE source_row malo_profiles%ROWTYPE; destination_row malo_profiles%ROWTYPE;
BEGIN
  IF guest_id = target_id THEN RETURN true; END IF;
  PERFORM id FROM malo_profiles WHERE id IN (guest_id,target_id) ORDER BY id FOR UPDATE;
  SELECT * INTO source_row FROM malo_profiles WHERE id=guest_id;
  SELECT * INTO destination_row FROM malo_profiles WHERE id=target_id;
  IF source_row.id IS NULL OR destination_row.id IS NULL OR source_row.version<>guest_version OR destination_row.version<>target_version THEN RETURN false; END IF;
  IF source_row.document->>'kind'<>'guest' OR source_row.document->>'mergedInto' IS NOT NULL THEN RAISE EXCEPTION 'Invalid guest merge'; END IF;
  UPDATE malo_profiles SET document=target_document,version=version+1,updated_at=now() WHERE id=target_id;
  UPDATE malo_profiles SET document=jsonb_set(jsonb_set(jsonb_set(document,'{mergedInto}',to_jsonb(target_id::text)),'{authVersion}',to_jsonb((document->>'authVersion')::integer+1)),'{state,refreshTokens}','[]'::jsonb),version=version+1,updated_at=now() WHERE id=guest_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.malo_merge_profiles(uuid,uuid,integer,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.malo_merge_profiles(uuid,uuid,integer,integer,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
