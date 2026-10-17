update public.penalty_rules
set min_delay_minutes=11,
    max_delay_minutes=null,
    tolerance_minutes=10,
    blocks_access=false
where active=true
  and lower(person_type)='staff'
  and target_scope='staff'
  and penalty_type='late_arrival'
  and application_mode='automatic';
notify pgrst,'reload schema';