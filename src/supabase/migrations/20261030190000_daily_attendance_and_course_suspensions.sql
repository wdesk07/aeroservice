-- Daily attendance is the source of truth for every learner's scheduled sessions.
-- A suspension is an auditable instruction from Direction, not an individual absence.

CREATE TABLE IF NOT EXISTS public.course_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formation_id uuid NULL REFERENCES public.formations(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  reason text NOT NULL,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT course_suspensions_dates_check CHECK (ends_on >= starts_on),
  CONSTRAINT course_suspensions_reason_check CHECK (length(trim(reason)) > 0)
);

ALTER TABLE public.course_suspensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Direction can read course suspensions" ON public.course_suspensions;
CREATE POLICY "Direction can read course suspensions"
  ON public.course_suspensions FOR SELECT TO authenticated
  USING (public.kiosk_actor_has_role(ARRAY['DIRECTOR','ADMIN','PRE_ADMIN']));

GRANT SELECT ON public.course_suspensions TO authenticated;

CREATE OR REPLACE FUNCTION public.record_course_suspension(
  p_formation_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.kiosk_actor_has_role(ARRAY['DIRECTOR','ADMIN','PRE_ADMIN']) THEN
    RAISE EXCEPTION 'COURSE_SUSPENSION_FORBIDDEN';
  END IF;
  IF p_starts_on IS NULL OR p_ends_on IS NULL OR p_ends_on < p_starts_on THEN
    RAISE EXCEPTION 'INVALID_SUSPENSION_DATES';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'SUSPENSION_REASON_REQUIRED';
  END IF;
  IF p_formation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.formations f WHERE f.id = p_formation_id AND f.status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORMATION_NOT_FOUND';
  END IF;

  INSERT INTO public.course_suspensions(formation_id, starts_on, ends_on, reason, created_by)
  VALUES (p_formation_id, p_starts_on, p_ends_on, trim(p_reason), auth.uid())
  RETURNING id INTO v_id;

  -- Keep the planned sessions in the database, but mark them cancelled for audit.
  UPDATE public.course_sessions cs
  SET status = 'cancelled',
      cancellation_reason = 'Suspension Direction: ' || trim(p_reason),
      updated_at = now()
  WHERE cs.session_date BETWEEN p_starts_on AND p_ends_on
    AND (p_formation_id IS NULL OR cs.formation_id = p_formation_id)
    AND cs.status <> 'cancelled';

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_course_suspension(uuid,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_course_suspension(uuid,date,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.materialize_formation_sessions_for_date(p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE n integer := 0;
BEGIN
  IF p_date IS NULL THEN RAISE EXCEPTION 'SESSION_DATE_REQUIRED'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.kiosk_actor_has_role(ARRAY['DIRECTOR','ADMIN','PRE_ADMIN','PEDAGOGY','STUDENT','APPRENANT','SECRETARIAT','SECRETARY','SECRETAIRE','SECRÉTAIRE','STAFF','PERSONNEL']) THEN
    RAISE EXCEPTION 'SESSION_MATERIALIZATION_FORBIDDEN';
  END IF;

  INSERT INTO public.course_sessions(
    schedule_template_id, formation_id, group_id, subject_id, teacher_id, room_id,
    session_date, planned_start, planned_end, session_type, status, created_by
  )
  SELECT st.id, st.formation_id, st.group_id, st.subject_id, st.teacher_id, st.room_id,
    p_date,
    (p_date + st.start_time) AT TIME ZONE 'Africa/Porto-Novo',
    (p_date + st.end_time) AT TIME ZONE 'Africa/Porto-Novo',
    'regular', 'scheduled', auth.uid()
  FROM public.schedule_templates st
  WHERE st.status = 'active'
    AND st.weekday = extract(isodow from p_date)::integer
    AND (st.valid_from IS NULL OR st.valid_from <= p_date)
    AND (st.valid_until IS NULL OR st.valid_until >= p_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.course_sessions cs
      WHERE cs.schedule_template_id = st.id AND cs.session_date = p_date
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.course_suspensions s
      WHERE s.revoked_at IS NULL AND p_date BETWEEN s.starts_on AND s.ends_on
        AND (s.formation_id IS NULL OR s.formation_id = st.formation_id)
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

CREATE OR REPLACE VIEW public.director_session_attendance AS
SELECT
  md5((cs.id::text || ':'::text) || st.id::text)::uuid AS id,
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
    WHEN suspension.id IS NOT NULL THEN 'suspended'
    WHEN a.id IS NULL THEN
      CASE
        WHEN (clock_timestamp() AT TIME ZONE 'Africa/Porto-Novo')::date > cs.session_date
          OR (
            (clock_timestamp() AT TIME ZONE 'Africa/Porto-Novo')::date = cs.session_date
            AND (clock_timestamp() AT TIME ZONE 'Africa/Porto-Novo')::time >= (
              SELECT max(cs2.planned_end) AT TIME ZONE 'Africa/Porto-Novo'
              FROM public.course_sessions cs2
              WHERE cs2.session_date = cs.session_date
                AND cs2.status <> 'cancelled'
                AND (
                  (cs2.group_id IS NOT NULL AND cs2.group_id = st.group_id)
                  OR (cs2.group_id IS NULL AND cs2.formation_id = st.formation_id)
                )
                AND NOT EXISTS (
                  SELECT 1 FROM public.course_suspensions s2
                  WHERE s2.revoked_at IS NULL AND cs2.session_date BETWEEN s2.starts_on AND s2.ends_on
                    AND (s2.formation_id IS NULL OR s2.formation_id = cs2.formation_id)
                )
            )::time
          )
        THEN 'absent'
        ELSE 'scheduled'
      END
    WHEN lower(COALESCE(a.status, '')) IN ('regularized_late', 'regularized', 'regularised', 'regularised_late')
      THEN 'regularized'
    WHEN lower(COALESCE(a.status, '')) = 'absent' THEN 'absent'
    WHEN a.arrived_at IS NULL THEN a.status
    WHEN lower(COALESCE(a.status, '')) = 'late' THEN 'late'
    ELSE 'on_time'
  END AS status,
  a.arrived_at,
  (cs.planned_start AT TIME ZONE 'Africa/Porto-Novo')::time AS nominal_time,
  (cs.planned_start AT TIME ZONE 'Africa/Porto-Novo')::time + interval '15 minutes' AS cutoff_time,
  GREATEST(0, COALESCE(a.minutes_after_cutoff, 0)) AS minutes_after_cutoff,
  a.id AS daily_attendance_id
FROM public.course_sessions cs
JOIN public.students st
  ON cs.group_id = st.group_id
  OR (cs.group_id IS NULL AND cs.formation_id = st.formation_id)
JOIN public.profiles p
  ON p.id = st.id AND lower(COALESCE(p.status, '')) = 'active'
LEFT JOIN public.formations f ON f.id = cs.formation_id
LEFT JOIN LATERAL (
  SELECT da.id, da.status, da.arrived_at, da.minutes_after_cutoff
  FROM public.daily_attendance da
  WHERE da.person_id = st.id
    AND lower(da.person_type) IN ('student','apprenant')
    AND da.local_date = cs.session_date
  ORDER BY da.arrived_at NULLS LAST, da.created_at
  LIMIT 1
) a ON true
LEFT JOIN LATERAL (
  SELECT s.id
  FROM public.course_suspensions s
  WHERE s.revoked_at IS NULL AND cs.session_date BETWEEN s.starts_on AND s.ends_on
    AND (s.formation_id IS NULL OR s.formation_id = cs.formation_id)
  ORDER BY s.created_at DESC
  LIMIT 1
) suspension ON true
WHERE cs.status <> 'cancelled' OR suspension.id IS NOT NULL;


CREATE OR REPLACE FUNCTION public.revoke_course_suspension(p_suspension_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_suspension public.course_suspensions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.kiosk_actor_has_role(ARRAY['DIRECTOR','ADMIN','PRE_ADMIN']) THEN
    RAISE EXCEPTION 'COURSE_SUSPENSION_FORBIDDEN';
  END IF;
  SELECT * INTO v_suspension
  FROM public.course_suspensions
  WHERE id = p_suspension_id AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_SUSPENSION_NOT_FOUND'; END IF;

  UPDATE public.course_suspensions
  SET revoked_at = now(), revoked_by = auth.uid()
  WHERE id = p_suspension_id;

  UPDATE public.course_sessions cs
  SET status = 'scheduled',
      cancellation_reason = NULL,
      updated_at = now()
  WHERE cs.session_date BETWEEN v_suspension.starts_on AND v_suspension.ends_on
    AND (v_suspension.formation_id IS NULL OR cs.formation_id = v_suspension.formation_id)
    AND cs.status = 'cancelled'
    AND cs.cancellation_reason = 'Suspension Direction: ' || v_suspension.reason
    AND NOT EXISTS (
      SELECT 1 FROM public.course_suspensions other
      WHERE other.id <> v_suspension.id
        AND other.revoked_at IS NULL
        AND cs.session_date BETWEEN other.starts_on AND other.ends_on
        AND (other.formation_id IS NULL OR other.formation_id = cs.formation_id)
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_course_suspension(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_course_suspension(uuid) TO authenticated;
