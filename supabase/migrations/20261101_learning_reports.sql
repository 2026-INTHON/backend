BEGIN;
ALTER TABLE public.malo_generation_jobs DROP CONSTRAINT malo_generation_jobs_kind_check;
ALTER TABLE public.malo_generation_jobs DROP CONSTRAINT malo_generation_jobs_check;
ALTER TABLE public.malo_generation_jobs ADD CONSTRAINT malo_generation_jobs_kind_check CHECK(kind IN ('personal','catalog','report'));
ALTER TABLE public.malo_generation_jobs ADD CONSTRAINT malo_generation_jobs_check CHECK((kind IN ('personal','report') AND owner_id IS NOT NULL) OR (kind='catalog' AND owner_id IS NULL));
-- Existing queue lease, service-only access and guest-owner migration apply to report jobs too.
COMMIT;
NOTIFY pgrst,'reload schema';
SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.malo_generation_jobs'::regclass AND conname IN('malo_generation_jobs_kind_check','malo_generation_jobs_check');
