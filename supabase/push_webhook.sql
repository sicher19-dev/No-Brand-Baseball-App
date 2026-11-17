-- Database trigger that calls the push edge function whenever a message is posted or a video is uploaded/reviewed.
-- Applied by the "Supabase - deploy" workflow, which fills in __PROJECT_REF__ and __PUSH_SECRET__ (never commit real values).
create extension if not exists pg_net with schema extensions;

create or replace function public.notify_push() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://__PROJECT_REF__.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', '__PUSH_SECRET__'),
    body := jsonb_build_object(
      'type', TG_OP, 'table', TG_TABLE_NAME,
      'record', to_jsonb(new),
      'old_record', case when TG_OP = 'UPDATE' then to_jsonb(old) else null end),
    timeout_milliseconds := 5000
  );
  return new;
end $$;

drop trigger if exists push_on_message on public.messages;
create trigger push_on_message
  after insert on public.messages
  for each row execute function public.notify_push();

drop trigger if exists push_on_assessment on public.assessments;
create trigger push_on_assessment
  after insert or update of reviewed_at, coach_note on public.assessments
  for each row execute function public.notify_push();
