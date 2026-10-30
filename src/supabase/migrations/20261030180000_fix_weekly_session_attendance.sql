-- Correct per-session attendance derivation for the production schema.
-- A daily check-in must be evaluated against each session's own start/end time.
CREATE OR REPLACE VIEW public.director_session_attendance AS
SELECT
  COALESCE(a.id, md5((cs.id::text || ':'::text) || st.id::text)::uuid) AS id,
  st.id AS person_id,
  p.display_name,
  p.first_name,
  p.last_name,
  st.student_number,
  cs.id AS session_id,
  cs.session_date,
  f.name AS formation_name,
  cs.planned_start,
  cs.planned_end,
  CASE
    WHEN a.id IS NULL THEN
      CASE
        WHEN (clock_timestamp() AT TIME ZONE 'Africa/Porto-Novo')::date > cs.session_date
          OR (
            (clock_timestamp() AT TIME ZONE 'Africa/Porto-Novo')::date = cs.session_date
            AND (clock_timestamp() AT TIME ZONE 'Africa/Porto-Novo')::time >= (cs.planned_end AT TIME ZONE 'Africa/Porto-Novo')::time
          )
        THEN 'absent'
        ELSE 'scheduled'
      END
    WHEN lower(COALESCE(a.status, '')) IN ('regularized_late', 'regularized', 'regularised', 'regularised_late')
      THEN 'regularized'
    WHEN lower(COALESCE(a.status, '')) = 'absent' THEN 'absent'
    WHEN a.arrived_at IS NULL THEN a.status
    WHEN a.arrived_at > cs.planned_end THEN 'absent'
    WHEN a.arrived_at > cs.planned_start + interval '15 minutes' THEN 'late'
    ELSE 'on_time'
  END AS status,
  a.arrived_at,
  (cs.planned_start AT TIME ZONE 'Africa/Porto-Novo')::time AS nominal_time,
  (cs.planned_start AT TIME ZONE 'Africa/Porto-Novo')::time + interval '15 minutes' AS cutoff_time,
  GREATEST(
    0,
    COALESCE(
      FLOOR(EXTRACT(EPOCH FROM (a.arrived_at - (cs.planned_start + interval '15 minutes'))) / 60)::integer,
      0
    )
  ) AS minutes_after_cutoff,
  a.id AS daily_attendance_id
FROM public.course_sessions cs
JOIN public.students st
  ON cs.group_id = st.group_id
  OR (cs.group_id IS NULL AND cs.formation_id = st.formation_id)
JOIN public.profiles p
  ON p.id = st.id AND lower(COALESCE(p.status, '')) = 'active'
LEFT JOIN public.formations f ON f.id = cs.formation_id
LEFT JOIN LATERAL (
  SELECT
    x.id, x.session_id, x.person_id, x.person_type, x.status, x.planned_at,
    x.arrived_at, x.delay_minutes, x.access_blocked, x.source, x.checkpoint_id,
    x.latitude, x.longitude, x.location_accuracy_m, x.anomaly, x.anomaly_reason,
    x.created_at, x.updated_at, x.metadata
  FROM public.attendance x
  WHERE x.person_id = st.id
    AND lower(x.person_type) = 'student'
    AND (COALESCE(x.arrived_at, x.planned_at, x.created_at) AT TIME ZONE 'Africa/Porto-Novo')::date = cs.session_date
  ORDER BY x.arrived_at, x.created_at
  LIMIT 1
) a ON true
WHERE lower(COALESCE(cs.status, '')) <> ALL (ARRAY['cancelled', 'canceled']);
