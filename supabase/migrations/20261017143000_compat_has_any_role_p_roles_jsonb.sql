create or replace function public.has_any_role(p_roles jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select private.has_any_role(
    array(select jsonb_array_elements_text(coalesce(p_roles, '[]'::jsonb)))
  );
$function$;

grant execute on function public.has_any_role(jsonb) to authenticated;

notify pgrst, 'reload schema';
